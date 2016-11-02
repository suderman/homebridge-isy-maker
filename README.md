# homebridge-isy-maker

Homebridge platform plugin to make virtual accessories as defined by [ISY-994i](https://www.universal-devices.com/residential/isy994i-series/) variables.   

[![](http://i.giphy.com/3o7TKDKsVFfMjsbo0o.gif)](https://media.giphy.com/media/3oz8xWHxeXd6wWeczC/source.gif)

This plugin is intended to compliment the excellent [homebridge-isy-js](https://github.com/rodtoll/homebridge-isy-js) plugin by [rodtoll](https://github.com/rodtoll). While [homebridge-isy-js](https://github.com/rodtoll/homebridge-isy-js) helps HomeKit understand your ISY-controlled Insteon & Z-Wave devices, there are situations where it'd be desirable to trigger an ISY program or Network Resource as well. 

For example: I have a TV that recieves infrared ON/OFF commands from my [iTach WF2IR](http://www.globalcache.com/products/itach/wf2irspecs/), which is controlled by my ISY via [Network Resources](https://wiki.universal-devices.com/index.php?title=ISY-994i_Series_INSTEON:Networking#Network_Resources). I can create an ISY program that runs an ON or OFF Network Resource, triggered whenever an ISY state variable's value is modified. And if I name this state variable in a special way (detailed below), this Homebridge plugin will make a virtual accessory available to HomeKit!

## Installation

1. Install homebridge using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g homebridge-isy-maker`
3. Update your configuration file. See [config-sample.json](https://github.com/suderman/homebridge-isy-maker/blob/master/config-sample.json) for an example. 
4. Add variables in the admin console of your ISY-994i and have programs run when their values change.

## Configuration

```
"platforms": [ 
  {
  "platform": "isy-maker",
    "name": "ISYMaker",
    "host": "10.0.0.10",
    "username": "admin",
    "password": "admin",
    "prefix": "hb"
  }
]
```

* `platform` - Must be set to isy-maker
* `name` - Can be set to whatever you want
* `host` - IP address of the ISY
* `username` - Your ISY username
* `password` - Your ISY password
* `prefix` - Your variables' prefix. Default is `hb`.


## Naming Variables

Each ISY variable represents a HomeKit accessory, service and characterstic. Only one service per accessory is supported, but this service may have mulitple characteristics. Services with multiple characterstics are represented with multiple variables---so long as they have a common name and service, these characteristics will be grouped together.

Variables names are composed of 4 or 5 segment, separated by dots. The first segment is the prefix (default `hb`), and that just flags this variable for use with Homebridge. The second segment is the accessory name (underscores will be displayed as spaces). The third segment is the service type, and the fourth segment is the characteristic type (valid services and characteristics can be found [here](https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js)). The fifth segment is optional, but you can override a characterstic's default props (keys and values are separated by underscores, and `N` is swapped for the negative `-` ).

Here's a full example, showing the structure:  

```
     hb.Custom_Thermometer.TemperatureSensor.CurrentTemperature.minValue_N150_maxValue_150
-------|------------------|-----------------|------------------|--------------------------
Prefix | Accessory Name   | Service         | Characteristic   | Optional Props
```

The plugin will check for changes to the list of variable names every 10 seconds. New accessories will then be added to HomeKit, or new characteristics will be added to existing accessories if it already exists. It works in reverse, and characterstics will be removed if those variables are removed, and if an accessory no longer has any variables, that accessory will be removed as well. 

Note: when adding/removing characteristics, you may need to force-quit and re-launch Apple's Home app to get the new UI to render.

## Examples

This isn't an exhaustive list of HomeKit accessories (that list would be found [here](https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js)), but here's some common examples. Keep in mind, Apple's Home app doesn't currently support everything (for example, volume), but many 3rd party HomeKit apps do just fine.

### Switches

- #### Switch
  `hb.My_Television.Switch.On`

- #### Outlet
  `hb.My_Heater.Outlet.On`  
  `hb.My_Heater.Outlet.OutletInUse`  

- #### Fan
  `hb.My_Fan.On`  
  `hb.My_Fan.RotationDirection`  
  `hb.My_Fan.RotationSpeed`  

### Lightbulbs

- #### Lightbulb
  `hb.My_Chandelier.Lightbulb.On`

- #### Dimmable Lightbulb  
  `hb.My_Sconce.Lightbulb.On`  
  `hb.My_Sconce.Lightbulb.Brightness`  

- #### Colour Lightbulb
  `hb.My_Lamp.Lightbulb.On`  
  `hb.My_Lamp.Lightbulb.Brightness`  
  `hb.My_Lamp.Lightbulb.Hue`  
  `hb.My_Lamp.Lightbulb.Saturation`  

### Sensors

- #### Contact Sensor
  `hb.My_Contact_Sensor.ContactSensor.ContactSensorState`

- #### Motion Sensor
  `hb.My_Motion_Sensor.MotionSensor.MotionSensorState`

- #### Occupancy Sensor
  `hb.My_Occupancy_Sensor.OccupancySensor.OccupancyDetected`

- #### Temperature Sensor
  `hb.My_Thermometer.TemperatureSensor.CurrentTemperature`

- #### Thermostat
  `hb.My_Thermostat.TemperatureSensor.CurrentTemperature`  
  `hb.My_Thermostat.TemperatureSensor.TargetTemperature`  
  `hb.My_Thermostat.TemperatureSensor.CurrentHeatingCoolingState`  
  `hb.My_Thermostat.TemperatureSensor.TargetHeatingCoolingState`  
  `hb.My_Thermostat.TemperatureSensor.TemperatureDisplayUnits`  

### Audio

- #### Speaker
  `hb.My_Stereo.Speaker.Mute`  
  `hb.My_Stereo.Speaker.Volume`

- #### Microphone
  `hb.My_Mic.Microphone.Mute`  
  `hb.My_Mic.Microphone.Volume`

## Minor bug note   

_tldr: restart the Homebridge process after making ISY variable name changes to fix realtime updates._

There is a small bug I haven't been able to squash, and I would appreciate if anyone can point out the fix. Normally, realtime updates work great: the Home app is open, you change an ISY variable's value externally, and the associated accessory updates instantly. However, this realtime updating seems to get lost whenever variable name changes are detected and characteristics/accessories are added/removed. The new characterstic will receive realtime updates, but all the other accessories won't. Normal on-demand updates still work fine: when the Home app is closed and reopened, all values are updated. Also, the websocket continues to receive messages, but updating the characteristic with the new value does nothing. 

And, stranger: this bug causes realtime updates to _other_ homebridge accessories to be broken too! Which makes me wonder if it's a deeper problem? Everything works fine again after restarting the Homebridge process, so it's not hard to work-around, but I'd like to avoid that requirement if possible.
