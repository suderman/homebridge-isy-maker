// DEBUG=* homebridge -D -I -P ./homebridge-isy-maker

var request = require('request'),
    WebSocket = require("faye-websocket"),
    Accessory, Service, Characteristic, UUIDGen, platform;

module.exports = function(homebridge) {
  console.log("homebridge API version: " + homebridge.version);

  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;
  
  homebridge.registerPlatform("homebridge-isy-maker", "isy-maker", ISYMaker, true);
}

// Platform constructor
function ISYMaker(log, config, api) {

  this.log = log;
  this.config = config;
  this.host = config.host;
  this.username = config.username;
  this.password = config.password;
  this.url = `http://${config.username}:${config.password}@${config.host}`;
  this.wsUrl = `ws://${config.host}/rest/subscribe`;
  this.prefix = (config.prefix==undefined) ? 'hb' : config.prefix;

  this.variables = new Map();
  this.variableNames = new Map();
  this.accessories = new Map();

  if (api) {
    this.api = api;
    this.api.on('didFinishLaunching', this.run.bind(this));
  }

  // Make this platform available globally
  platform = this;
}


// After cached accessories are loaded, run main loop
ISYMaker.prototype.run = function() {

  // Watch for variable name changes
  ISYMakerVariable.watch(this.variables, (newVariables = [], oldVariables = []) => {
    // platform.log('OLD: ', oldVariables)
    // platform.log('NEW: ', newVariables)

    // Remove variables no longer found on the ISY
    oldVariables.forEach(variable => this.removeCharacteristic(variable));

    // Wait a couple seconds (required, or all accessories stop responding without a restart)
    setTimeout(() => {

      // Process new variables found on the ISY, creating new accessories or adding to existing
      var characteristics = newVariables.map(variable => this.addCharacteristic(variable));

      // Wait a couple seconds
      setTimeout(() => {

        // Add the set/get events to any new characteristics
        this.configureCharacteristics(characteristics);

      }, 2000);

    }, 2000);
  });

  // Also open websocket for real-time value changes from ISY
  this.initializeWebSocket();
}


// Function invoked when homebridge tries to restore cached accessory
ISYMaker.prototype.configureAccessory = function(cachedAccessory) {
  this.log('Cached Accessory', cachedAccessory.displayName);

  // Get cached accessory's service
  var service = cachedAccessory.getService(Service[cachedAccessory.context.serviceType]);

  // Collect array of characteristics
  var characteristics = cachedAccessory.context.variables.map(contextVariable => {

    // Track all variables in cached accessory
    var variable = new ISYMakerVariable(contextVariable.isyType, contextVariable.isyID, contextVariable.isyName);
    this.variables.set(variable.ID, variable);
    this.variableNames.set(`${variable.isyType}-${variable.isyID}`, variable.isyName);

    // Store variable ID in characteristic for the next step
    var characteristic = service.getCharacteristic(Characteristic[variable.characteristicType]);
    characteristic.ID = variable.ID;

    return characteristic;
  });

  // Configure characteristics
  this.configureCharacteristics(characteristics);

  // Set up identification details
  this.setAccessoryInformation(cachedAccessory);

  // Track cached accessory
  this.accessories.set(cachedAccessory.UUID, cachedAccessory);
}

ISYMaker.prototype.addCharacteristic = function(variable) {
  var serviceType = variable.serviceType,
      characteristicType = variable.characteristicType;

  // First save this variable into the map
  this.variables.set(variable.ID, variable);
  this.variableNames.set(`${variable.isyType}-${variable.isyID}`, variable.isyName);

  // Attempt to find existing accessory in this variable, or create a new accessory
  var accessory = this.accessories.get(variable.UUID) || this.addAccessory(variable);

  // Add variable to accessory's context
  accessory.context.variables.push(variable);

  // Get or create this variable's characteristic
  var service = accessory.getService(Service[serviceType]);
  var characteristic = service.getCharacteristic(Characteristic[characteristicType]) 
                    || service.addCharacteristic(Characteristic[characteristicType]);

  // Store variable ID in characteristic for the next step
  characteristic.ID = variable.ID

  // Return this variable's characterstic to be collected
  return characteristic;
}


ISYMaker.prototype.addAccessory = function(variable) {
  var UUID = variable.UUID, 
      displayName = variable.displayName,
      serviceType = variable.serviceType;

  // Get or create accessory from variable
  this.log('Add new accessory', displayName);
  accessory = new Accessory(displayName, UUID);

  // Set main service type
  accessory.addService(Service[serviceType], accessory.displayName);

  // Initiate context
  accessory.context.variables = [];
  accessory.context.serviceType = serviceType;

  // Set up identification details
  this.setAccessoryInformation(accessory);

  // Add it to the list and register to the platform
  this.accessories.set(UUID, accessory);
  this.api.registerPlatformAccessories("homebridge-isy-maker", "isy-maker", [accessory]);

  // Return this new accessory
  return accessory;
}


// Configure service and required characterstics
ISYMaker.prototype.configureCharacteristics = function(characteristics = []) {
  // this.log('configureCharacteristics', characteristics);

  characteristics.forEach(characteristic => {
    var variable = this.variables.get(characteristic.ID); 
    var characteristicType = variable.characteristicType;

    this.log('Add Variable to Characteristic', characteristicType);

    // Setter and getter
    characteristic.on('set', variable.setValue.bind(variable));
    characteristic.on('get', variable.getValue.bind(variable));
    
    // characteristic.on('set', (value, callback) => {
    //   if (value == true) value = 1;
    //   if (value == false) value = 0;
    //   this.log('on set:', value, variable);
    //   variable.setValue(value, callback)
    // });
    // characteristic.on('get', (callback) => {
    //   this.log('on get:', variable);
    //   variable.getValue(callback)
    // });

    // Custom props
    characteristic.setProps(variable.props);
  });
}


// Set up manufacturer, model, serial number (based on variable type, id)
ISYMaker.prototype.setAccessoryInformation = function(accessory) {

  // Build Serial Number
  var serial = accessory.context.variables.map(v => `${v.isyType}.${v.isyID}`).join(' ');
  if (serial == '') serial = 'Internal';

  // Set identification details
  accessory.getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, 'Universial Devices')
    .setCharacteristic(Characteristic.Model, 'ISY-994i Series')
    .setCharacteristic(Characteristic.SerialNumber, serial);

  // Respond to identify request
  accessory.on('identify', (paired, callback) => {
    platform.log(accessory.displayName, "Identify!");
    callback();
  });

  // Reachable from go
  accessory.reachable = true;
}


ISYMaker.prototype.updateAccessoriesReachability = function(reachable = true) {
  this.log("Update Reachability");
  this.accessories.forEach(function(accessory) {
    accessory.updateReachability(reachable);
  });
}


// Sample function to show how developer can remove accessory dynamically from outside event
ISYMaker.prototype.removeCharacteristic = function(variable) {
  var accessory = this.accessories.get(variable.UUID);
  if (!accessory) return false;

  // Remove this characteristic from the accessory
  var service = accessory.getService(Service[variable.serviceType]);
  var characteristic = service.getCharacteristic(Characteristic[variable.characteristicType]);
  service.removeCharacteristic(characteristic);

  // Remove this variable from the accessory's context
  for (var index in accessory.context.variables) {
    if (accessory.context.variables[index].ID == variable.ID) {
      accessory.context.variables.splice(index, 1);
    }
  }

  // And now delete this variable from the map
  this.variables.delete(variable.ID);
  this.variableNames.delete(`${variable.isyType}-${variable.isyID}`);
  
  // If this was the last variable, unregister the accessory
  if (!accessory.context.variables.length) {
    this.api.unregisterPlatformAccessories("homebridge-isy-maker", "isy-maker", [accessory]);
    this.accessories.delete(accessory.UUID);
  }

}


ISYMaker.prototype.initializeWebSocket = function() {

  this.webSocket = new WebSocket.Client(this.wsUrl, ["ISYSUB"], {
    headers: {
      "Origin": "com.universal-devices.websockets.isy",
      "Authorization": 'Basic ' + new Buffer(`${this.username}:${this.password}`).toString('base64')			
    }
  });

  // this.lastActivity = new Date();

  this.webSocket.on('message', (event) => {
    if (!event.data.includes('</var>')) return; 

    var isyType, isyID, isyValue = false;

    // ISY 5.x
    if (event.data.includes('<prec>')) {
      [, isyType, isyID, , isyValue ] = event.data.split(/type="|" id="|"><prec>|<val>|<\/val>/);

    // ISY 4.x
    } else {
      [, isyType, isyID, isyValue ] = event.data.split(/type="|" id="|"><val>|<\/val>/);
    }

    this.log('WebSocket => type: ', isyType, ' id: ', isyID, ' value: ', isyValue);

    // this.log('variable by type and id: ', `${isyType}-${isyID}`);
    // this.log(this.variableNames.get(`${isyType}-${isyID}`));

    var variable = new ISYMakerVariable(isyType, isyID, this.variableNames.get(`${isyType}-${isyID}`));
    // this.log('variable', variable);
    if (!variable.ID) return;

    var accessory = this.accessories.get(variable.UUID);
    // this.log('accessory', accessory);
    if (!accessory) return;

    var characteristic = accessory.getService(Service[variable.serviceType])
                                  .getCharacteristic(Characteristic[variable.characteristicType]);
    if (!characteristic) return;

    var newValue = Number.parseInt(isyValue, 10),
        oldValue = Number.parseInt(characteristic.value, 10);
    if (newValue == oldValue) return;

    characteristic.setValue(newValue, null, '_websocket');
  });
}



// Determine accessory's name, service, characterstic (+ optional props) from ISY variable name
function ISYMakerVariable(isyType = 0, isyID = 0, isyName = '') {

  // Ensure variable name begins with prefix
  if (!isyName.startsWith(platform.prefix)) return false;

  // Split variable name into parts, separated by period
  var isyParts = isyName.split('.');

  // Ensure there are 4 parts (1_PREFIX.2_NAME.3_SERVICE.4_CHARACTERISTIC.5_OPTIONAL_PROPS)
  if (isyParts.length < 4) return false;

  var prefix = isyParts.shift(),
      name = isyParts.shift(),
      serviceType = isyParts.shift(),
      characteristicType = isyParts.shift(),
      propsPairs = isyParts.join('.').split('_'),
      props = {};

  // Exit if unknown service type or characteristic type
  if ((!Service[serviceType]) || (!Characteristic[characteristicType])) return false;

  // Convert array of props pairs ['one', 1, 'two', 2] into object { one: 1, two: 2 }
  if (propsPairs.length > 1) {
    var k = 0, v = 1, len = propsPairs.length;
    for (; v < len; k++, k++, v++, v++) {
      var key = propsPairs[k], value = propsPairs[v].replace(/N/g, '-');
      if (!Number.isNaN(value)) {
        value = (value.includes('.')) ? Number.parseFloat(value) : Number.parseInt(value, 10);
      }
      props[key] = value;
    }
  }

  // Assign variable properties
  this.isyType = Number.parseInt(isyType, 10);
  this.isyID = Number.parseInt(isyID, 10);
  this.isyName = isyName;
  this.ID = `${this.isyType}-${this.isyID}-${this.isyName}`;

  // Assign accessory properties
  this.name = name,
  this.displayName = name.replace(/_/g, ' ');
  this.serviceType = serviceType;
  this.characteristicType = characteristicType;
  this.props = props;
  this.UUID = UUIDGen.generate(name + serviceType);
}

// Set ISY variable
ISYMakerVariable.prototype.setValue = function(value, callback) {
  if (value == true) value = 1;
  if (value == false) value = 0;
  var url = `${platform.url}/rest/vars/set/${this.isyType}/${this.isyID}/${value}`;
  request(url, function(error, response, body) {
    callback(null);
  });
}

// Get ISY variable
ISYMakerVariable.prototype.getValue = function(callback) {
  var url = `${platform.url}/rest/vars/get/${this.isyType}/${this.isyID}`;
  request(url, function(error, response, body) {
    var value = Number.parseInt(body.split(/<val>|<\/val>/)[1], 10);
    callback(null, value);
  });
}


// Returns removed variables
ISYMakerVariable.updateList = function(currentVariables, callback) {
  var newVariables = new Map(),
      oldVariables = new Map(currentVariables);

  function parseVariableXML(xml, isyType) {
    var isyID, isyName = false;

    xml.split('<e').forEach(entry => { 

      // ISY 5.x
      if (xml.includes('id="prec"')) {
        [, isyID, isyName ] = entry.split(/ id="|" name="|"><val|" \/>/);

      // ISY 4.x
      } else {
        [, isyID, isyName ] = entry.split(/ id="|" name="|" \/>/);
      }        

      if ((!isyType) || (!isyID) || (!isyName)) return;

      var variable = new ISYMakerVariable(isyType, isyID, isyName);
      if (variable.isyID) {

        // If this variable already exists, take it off the nix list
        if (currentVariables.has(variable.ID)) {
          oldVariables.delete(variable.ID);

        // If it doesn't exist, add it to the new list 
        } else {
          newVariables.set(variable.ID, variable);
        }

      }
    });
  }

  // Pull latest integer variables
  request(`${platform.url}/rest/vars/definitions/1`, (error, response, body) => {
    parseVariableXML(body, 1);

    // Next, latest state variables
    request(`${platform.url}/rest/vars/definitions/2`, (error, response, body) => {
      parseVariableXML(body, 2)

      // Callback with the new and old variables
      callback(Array.from(newVariables.values()), Array.from(oldVariables.values()));
    });
  });
}


// Runs periodically, triggers discover to set up accessories when ISY variable name changes are detected 
ISYMakerVariable.watch = function(currentVariables, callback, lastCheck = '') {
  this.check(thisCheck => {

    // If no change, do nothing
    if (thisCheck == lastCheck) {

    // Else, take note of the variable names and do something with these variables!
    } else {
      platform.log("Change detected, scanning ISY variables");
      lastCheck = thisCheck;

      // Update variable list, then process new services and/or characteristics
      this.updateList(currentVariables, (newVariables, oldVariables) => callback(newVariables, oldVariables));
    }

    // Rerun this method after waiting for 10 seconds
    setTimeout(this.watch.bind(this, currentVariables, callback, lastCheck), 10000);
  
  });
}

ISYMakerVariable.check = function(callback) {
  var xml = '';
  request(`${platform.url}/rest/vars/definitions/1`, function(error, response, body) {
    xml += body;
    request(`${platform.url}/rest/vars/definitions/2`, function(error, response, body) {
      callback(xml += body);
    });
  });
}
