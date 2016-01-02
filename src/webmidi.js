(function(scope) {

  "use strict";

  /**
   * The `WebMidi` object makes it easier to work with the Web MIDI API. Basically, it simplifies
   * two things: sending and receiving MIDI messages.
   *
   * To send MIDI messages, you simply need to call the desired method (`playNote()`,
   * `sendPitchBend()`, `stopNote()`, etc.) with the appropriate parameters and all the native MIDI
   * communication will be handled for you. The only additional thing that needs to be done is
   * enable `WebMidi`. Here is an example:
   *
   *      WebMidi.enable(function() {
   *        WebMidi.playNote("C3");
   *      });
   *
   * The code above, calls the `WebMidi.enable()` method. Upon success, this method executes the
   * callback function specified as a parameter. In this case, the callback calls the `playnote()`
   * function to play a 3rd octave C on all devices and channels.
   *
   * Receiving messages is just as easy. You simply have to set a callback function to be triggered
   * when a specific MIDI message is received. For example, to listen for pitch bend events on any
   * input MIDI channels:
   *
   *      WebMidi.addListener('pitchbend', function(e) {
   *        console.log("Pitch value: " + e.value);
   *      });
   *
   * As you can see, this library makes it much easier to use the Web MIDI API. No need to manually
   * craft or decode binary MIDI messages anymore!
   *
   * @class WebMidi
   * @static
   *
   * @todo  Add RPN and NRPM message sending capability (http://www.2writers.com/eddie/TutNrpn.htm)
   * @todo  Add removeAllEventListeners(), on() and once() functions
   * @todo  Add a 'filter' parameter to addListener. This would allow to listen for a specific
   *        controller on a controlchange event or a specific note on a event message.
   *
   * @todo  Add more examples in method documentation (playNote namely).
   * @todo  Add specific events for channel mode messages ?
   * @todo  Yuidoc does not allow multiple exceptions (@throws) for a single method ?!
   * @todo  Should the sendsysex method allow Uint8Array param ?
   * @todo  Define textual versions of channel mode messages
   * @todo  State change events (MIDIConnectionEvent) are triggered for each device being connected
   *        or disconnected. Therefore, we should add the ability to filter the statechange listener
   *        by device.
   */
  function WebMidi() {

    Object.defineProperties(this, {

      /**
       * [read-only] Indicates whether the browser supports the Web MIDI API or not.
       *
       * @property supported
       * @type Boolean
       * @static
       */
      supported: {
        enumerable: true,
        get: function() {
          return "requestMIDIAccess" in navigator;
        }
      },

      /**
       * [read-only] Indicates whether the interface to the host's MIDI subsystem is
       * currently active.
       *
       * @property connected
       * @type Boolean
       * @static
       */
      connected: {
        enumerable: true,
        get: function() {
          return this.interface !== undefined;
        }
      },

      /**
       * [read-only] An array of all currently available MIDI input devices.
       *
       * @property inputs
       * @type {MIDIInput[]}
       * @static
       */
      inputs: {
        enumerable: true,
        get: function() {
          var inputs = [];
          if (this.connected) {
            var ins = this.interface.inputs.values();
            for (var input = ins.next(); input && !input.done; input = ins.next()) {
              inputs.push(input.value);
            }
          }
          return inputs;
        }
      },

      /**
       * [read-only] An array of all currently available MIDI output devices.
       *
       * @property outputs
       * @type {MIDIOutput[]}
       * @static
       */
      outputs: {
        enumerable: true,
        get: function() {
          var outputs = [];
          if (this.connected) {
            var outs = this.interface.outputs.values();
            for (var input = outs.next(); input && !input.done; input = outs.next()) {
              outputs.push(input.value);
            }
          }
          return outputs;
        }
      },

      /**
       * [read-only] Current MIDI performance time in milliseconds. This can be used to queue events
       * in the future.
       *
       * @property time
       * @type DOMHighResTimeStamp
       * @static
       */
      time: {
        enumerable: true,
        get: function() {
          return window.performance.now();
        }
      }

    });

    _initializeUserHandlers();

  }

  //////////////////////////////// PRIVATE PROPERTIES ////////////////////////////////////

  // User-defined handlers list
  var _userHandlers = { "channel": {}, "system": {} };

  // List of valid MIDI channel data bytes (and matching value)
  var _channelMessages = {
    "noteoff": 0x8,           // 8
    "noteon": 0x9,            // 9
    "keyaftertouch": 0xA,     // 10
    "controlchange": 0xB,     // 11
    "channelmode": 0xB,       // 11
    "programchange": 0xC,     // 12
    "channelaftertouch": 0xD, // 13
    "pitchbend": 0xE          // 14
  };

  // List of valid system MIDI messages and matching value (249 and 253 are actually dispatched by
  // the Web MIDI API but I do not know what they are for and they are not part of the online MIDI
  // 1.0 spec. (http://www.midi.org/techspecs/midimessages.php)
  var _systemMessages = {
    "sysex": 0xF0,            // 240
    "timecode": 0xF1,         // 241
    "songposition": 0xF2,     // 242
    "songselect": 0xF3,       // 243
    "tuningrequest": 0xF6,    // 246
    "sysexend": 0xF7,         // 247 (never actually received - simply ends a sysex)
    "clock": 0xF8,            // 248
    "start": 0xFA,            // 250
    "continue": 0xFB,         // 251
    "stop": 0xFC,             // 252
    "activesensing": 0xFE,    // 254
    "reset": 0xFF,            // 255
    "unknownsystemmessage": -1
  };

  var _notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  //////////////////////////////////////// PRIVATE METHODS /////////////////////////////////////////

  /**
   * @method _initializeUserHandlers
   * @private
   */
  function _initializeUserHandlers() {

    _userHandlers.system.statechange = [];

    for (var prop1 in _channelMessages) {
      if (_channelMessages.hasOwnProperty(prop1)) {
        _userHandlers.channel[prop1] = {};
      }
    }

    for (var prop2 in _systemMessages) {
      if (_systemMessages.hasOwnProperty(prop2)) {
        _userHandlers.system[prop2] = [];
      }
    }

  }

  /**
   * @method _onInterfaceStateChange
   * @private
   */
  function _onInterfaceStateChange(e) {

    /**
     * Event emitted when the interface's state changes. Typically, this happens when a MIDI device
     * is being plugged or unplugged. This event cannot be listened on a single specific MIDI
     * device, it is intended to be interface-wide.
     *
     * @event statechange
     *
     * @param {Object} MIDIConnectionEvent
     */
    _userHandlers.system.statechange.forEach(function(handler){
      handler(e);
    });

  }

  /**
   * @method _parseChannelEvent
   * @param e Event
   * @private
   */
  function _parseChannelEvent(e) {

    var command = e.data[0] >> 4;
    var channel = (e.data[0] & 0xf) + 1;
    var data1, data2;

    if (e.data.length > 1) {
      data1 = e.data[1];
      data2 = e.data.length > 2 ? e.data[2] : undefined;
    }

    // Returned event
    var event = {
      "device": e.currentTarget,
      "data": e.data,
      "receivedTime": e.receivedTime,
      "timeStamp": e.timeStamp,
      "channel": channel
    };

    if (
        command === _channelMessages.noteoff ||
        (command === _channelMessages.noteon && data2 === 0)
    ) {

      /**
       * Event emitted when a note off MIDI message has been received on a specific device and
       * channel.
       *
       * @event noteoff
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit values.
       * @param {Number} event.receivedTime The time when the event occurred (in milliseconds since
       *                                    start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred (in milliseconds
       *                                    since the epoch).
       * @param {uint} event.channel        The channel where the event occurred (between 1 and 16).
       * @param {String} event.type         The type of event that occurred.
       * @param {Object} event.note
       * @param {uint} event.note.number    The MIDI note number.
       * @param {String} event.note.name    The usual note name (C, C#, D, D#, etc.).
       * @param {uint} event.note.octave    The octave (between -2 and 8).
       * @param {Number} event.velocity     The release velocity (between 0 and 1).
       */
      event.type = 'noteoff';
      event.note = {
        "number": data1,
        "name": _notes[data1 % 12],
        "octave": Math.floor(data1 / 12 - 1) - 3
      };
      event.velocity = data2 / 127;

    } else if (command === _channelMessages.noteon) {

      /**
       * Event emitted when a note on MIDI message has been received on a specific device and
       * channel.
       *
       * @event noteon
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in milliseconds since
       *                                    start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred (in milliseconds
       *                                    since the epoch).
       * @param {uint} event.channel        The channel where the event occurred (between 1 and 16).
       * @param {String} event.type         The type of event that occurred.
       * @param {Object} event.note
       * @param {uint} event.note.number    The MIDI note number.
       * @param {String} event.note.name    The usual note name (C, C#, D, D#, etc.).
       * @param {uint} event.note.octave    The octave (between -2 and 8).
       * @param {Number} event.velocity     The attack velocity (between 0 and 1).
       */
      event.type = 'noteon';
      event.note = {
        "number": data1,
        "name": _notes[data1 % 12],
        "octave": Math.floor(data1 / 12 - 1) - 3
      };
      event.velocity = data2 / 127;

    } else if (command === _channelMessages.keyaftertouch) {

      /**
       * Event emitted when a key-specific aftertouch MIDI message has been received on a specific
       * device and channel.
       *
       * @event keyaftertouch
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in milliseconds since
       *                                    start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred (in milliseconds
       *                                    since the epoch).
       * @param {uint} event.channel        The channel where the event occurred (between 1 and 16).
       * @param {String} event.type         The type of event that occurred.
       * @param {Object} event.note
       * @param {uint} event.note.number    The MIDI note number.
       * @param {String} event.note.name    The usual note name (C, C#, D, D#, etc.).
       * @param {uint} event.note.octave    The octave (between -2 and 8).
       * @param {Number} event.value        The aftertouch amount (between 0 and 1).
       */
      event.type = 'keyaftertouch';
      event.note = {
        "number": data1,
        "name": _notes[data1 % 12],
        "octave": Math.floor(data1 / 12 - 1) - 3
      };
      event.value = data2 / 127;

    } else if (
        command === _channelMessages.controlchange &&
        data1 >= 0 && data1 <= 119
    ) {

      /**
       * Event emitted when a control change MIDI message has been received on a specific device and
       * channel.
       *
       * @event controlchange
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in milliseconds since
       *                                    start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred (in milliseconds
       *                                    since the epoch).
       * @param {uint} event.channel        The channel where the event occurred (between 1 and 16).
       * @param {String} event.type         The type of event that occurred.
       * @param {Object} event.controller
       * @param {uint} event.controller.number     The number of the controller.
       * @param {String} event.controller.name     The number of the controller.
       * @param {uint} event.value          The value received (between 0 and 127).
       */
      event.type = 'controlchange';
      event.controller = {
        "number": data1,
        "name": ""
      };
      event.value = data2;

    } else if (
        command === _channelMessages.channelmode &&
        data1 >= 120 && data1 <= 127
    ) {

      /**
       * Event emitted when a channel mode MIDI message has been received on a specific device and
       * channel.
       *
       * @event channelmode
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in milliseconds since
       *                                    start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred (in milliseconds
       *                                    since the epoch).
       * @param {uint} event.channel        The channel where the event occurred (between 1 and 16).
       * @param {String} event.type         The type of event that occurred.
       * @param {Object} event.controller
       * @param {uint} event.controller.number     The number of the controller.
       * @param {String} event.controller.name     The number of the controller.
       * @param {uint} event.value          The value received (between 0 and 127).
       */
      event.type = 'channelmode';
      event.controller = {
        "number": data1,
        "name": ""
      };
      event.value = data2;

    } else if (command === _channelMessages.programchange) {

      /**
       * Event emitted when a program change MIDI message has been received on a specific device and
       * channel.
       *
       * @event programchange
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in milliseconds since
       *                                    start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred (in milliseconds
       *                                    since the epoch).
       * @param {uint} event.channel        The channel where the event occurred (between 1 and 16).
       * @param {String} event.type         The type of event that occurred.
       * @param {uint} event.value          The value received (between 0 and 127).
       */
      event.type = 'programchange';
      event.value = data1;

    } else if (command === _channelMessages.channelaftertouch) {

      /**
       * Event emitted when a channel-wide aftertouch MIDI message has been received on a specific
       * device and channel.
       *
       * @event channelaftertouch
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in milliseconds since
       *                                    start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred (in milliseconds
       *                                    since the epoch).
       * @param {uint} event.channel        The channel where the event occurred (between 1 and 16).
       * @param {String} event.type         The type of event that occurred.
       * @param {Number} event.value        The aftertouch value received (between 0 and 1).
       */
      event.type = 'channelaftertouch';
      event.value = data1 / 127;

    } else if (command === _channelMessages.pitchbend) {

      /**
       * Event emitted when a pitch bend MIDI message has been received on a specific device and
       * channel.
       *
       * @event pitchbend
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit values.
       * @param {Number} event.receivedTime The time when the event occurred (in milliseconds since
       *                                    start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred (in milliseconds
       *                                    since the epoch).
       * @param {uint} event.channel        The channel where the event occurred (between 1 and 16).
       * @param {String} event.type         The type of event that occurred.
       * @param {Number} event.value        The pitch bend value received (between -1 and
       *                                    1).
       */
      event.type = 'pitchbend';
      event.value = ((data2 << 7) + data1 - 8192) / 8192;
    } else {
      event.type = 'unknownchannelmessage';
    }

    // If some callbacks have been defined for this event, on that device and channel, execute them.
    if (
        _userHandlers.channel[event.type][event.device.id] &&
        _userHandlers.channel[event.type][event.device.id][channel]
    ) {
      _userHandlers.channel[event.type][event.device.id][channel].forEach(
          function(callback) { callback(event); }
      );
    }

  }

  /**
   * @method _parseSystemEvent
   * @private
   */
  function _parseSystemEvent(e) {

    var command = e.data[0];

    // Returned event
    var event = {
      "device": e.currentTarget,
      "data": e.data,
      "receivedTime": e.receivedTime,
      "timeStamp": e.timeStamp
    };

    if (command === _systemMessages.sysex) {

      /**
       * Event emitted when a system exclusive MIDI message has been received.
       *
       * @event sysex
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in
       *                                    milliseconds since start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred
       *                                    (in milliseconds since the epoch).
       * @param {String} event.type         The type of event that occurred.
       */
      event.type = 'sysex';

    } else if (command === _systemMessages.timecode) {

      /**
       * Event emitted when a system MIDI time code quarter frame message has been received.
       *
       * @event timecode
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit values.
       * @param {Number} event.receivedTime The time when the event occurred (in
       *                                    milliseconds since start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred
       *                                    (in milliseconds since the epoch).
       * @param {String} event.type         The type of event that occurred.
       */
      event.type = 'timecode';

      //@todo calculate time values and make them directly available

    } else if (command === _systemMessages.songposition) {

      /**
       * Event emitted when a system song position pointer MIDI message has been received.
       *
       * @event songposition
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit values.
       * @param {Number} event.receivedTime The time when the event occurred (in
       *                                    milliseconds since start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred
       *                                    (in milliseconds since the epoch).
       * @param {String} event.type         The type of event that occurred.
       */
      event.type = 'songposition';

      //@todo calculate position value and make it directly available

    } else if (command === _systemMessages.songselect) {

      /**
       * Event emitted when a system song select MIDI message has been received.
       *
       * @event songselect
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in
       *                                    milliseconds since start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred
       *                                    (in milliseconds since the epoch).
       * @param {String} event.type         The type of event that occurred.
       * @param {String} event.song         Song (or sequence) number to select.
       */
      event.type = 'songselect';
      event.song = e.data[1];

    } else if (command === _systemMessages.tuningrequest) {

      /**
       * Event emitted when a system tune request MIDI message has been received.
       *
       * @event tuningrequest
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in
       *                                    milliseconds since start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred
       *                                    (in milliseconds since the epoch).
       * @param {String} event.type         The type of event that occurred.
       */
      event.type = 'tuningrequest';

    } else if (command === _systemMessages.clock) {

      /**
       * Event emitted when a system timing clock MIDI message has been received.
       *
       * @event clock
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in
       *                                    milliseconds since start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred
       *                                    (in milliseconds since the epoch).
       * @param {String} event.type         The type of event that occurred.
       */
      event.type = 'clock';

    } else if (command === _systemMessages.start) {

      /**
       * Event emitted when a system start MIDI message has been received.
       *
       * @event start
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in
       *                                    milliseconds since start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred
       *                                    (in milliseconds since the epoch).
       * @param {String} event.type         The type of event that occurred.
       */
      event.type = 'start';

    } else if (command === _systemMessages.continue) {

      /**
       * Event emitted when a system continue MIDI message has been received.
       *
       * @event continue
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in
       *                                    milliseconds since start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred
       *                                    (in milliseconds since the epoch).
       * @param {String} event.type         The type of event that occurred.
       */
      event.type = 'continue';

    } else if (command === _systemMessages.stop) {

      /**
       * Event emitted when a system stop MIDI message has been received.
       *
       * @event stop
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in
       *                                    milliseconds since start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred
       *                                    (in milliseconds since the epoch).
       * @param {String} event.type         The type of event that occurred.
       */
      event.type = 'stop';

    } else if (command === _systemMessages.activesensing) {

      /**
       * Event emitted when a system active sensing MIDI message has been received.
       *
       * @event activesensing
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in
       *                                    milliseconds since start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred
       *                                    (in milliseconds since the epoch).
       * @param {String} event.type         The type of event that occurred.
       */
      event.type = 'activesensing';

    } else if (command === _systemMessages.reset) {

      /**
       * Event emitted when a system reset MIDI message has been received.
       *
       * @event reset
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in
       *                                    milliseconds since start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred
       *                                    (in milliseconds since the epoch).
       * @param {String} event.type         The type of event that occurred.
       */
      event.type = 'reset';

    } else {

      /**
       * Event emitted when an unknown system MIDI message has been received. It could be,
       * for example, one of the undefined/reserved messages.
       *
       * @event unknownsystemmessage
       *
       * @param {Object} event
       * @param {MIDIInput} event.device    The MIDI input device that triggered the event.
       * @param {Uint8Array} event.data     The raw MIDI message as an array of 8 bit
       *                                    values.
       * @param {Number} event.receivedTime The time when the event occurred (in
       *                                    milliseconds since start).
       * @param {uint} event.timeStamp      The timestamp when the event occurred
       *                                    (in milliseconds since the epoch).
       * @param {String} event.type         The type of event that occurred.
       */
      event.type = 'unknownsystemmessage';

    }

    // If some callbacks have been defined for this event, execute them.
    if (_userHandlers.system[event.type]) {
      _userHandlers.system[event.type].forEach(
          function(callback) { callback(event); }
      );
    }

  }

  /**
   * @method _onMidiMessage
   * @private
   */
  function _onMidiMessage(e) {

    if (e.data[0] < 240) {          // device and channel-specific message
      _parseChannelEvent(e);
    } else if (e.data[0] <= 255) {  // system message
      _parseSystemEvent(e);
    }

  }

  /**
   * Checks if the Web MIDI API is available and then tries to connect to the host's MIDI
   * subsystem. If the operation succeeds, the `successHandler` callback is executed.
   * If not, the `errorHandler` callback is executed and passed a string describing the
   * error.
   *
   * @method enable
   * @static
   *
   * @param [successHandler] {Function} A function to execute upon success.
   * @param [errorHandler] {Function}   A function to execute upon error. This function
   *                                    will be passed a string describing the error.
   * @param [sysex=false] {Boolean}     Whether to enable sysex or not. When this
   *                                    parameter is set to true, the browser may prompt
   *                                    the user for authorization.
   */
  WebMidi.prototype.enable = function(successHandler, errorHandler, sysex) {

    var that = this;

    if (
        (successHandler && typeof successHandler !== "function") ||
        (errorHandler && typeof errorHandler !== "function")
    ) {
      throw new TypeError("The success and error handlers must be functions.");
    }

    if (!this.supported && errorHandler) {
      errorHandler("The Web MIDI API is not supported by your browser.");
      return;
    }

    navigator.requestMIDIAccess({"sysex": sysex}).then(

        function(midiAccess) {
          that.interface = midiAccess;

          that.interface.onstatechange = _onInterfaceStateChange;

          that.inputs.forEach(function(input) {
            input.onmidimessage = _onMidiMessage;
          });

          if (successHandler) { successHandler(); }

        },
        errorHandler
    );

  };

  /**
   * Adds an event listener that will trigger a function callback when the specified event happens.
   * By default, the listener is system-wide (it will listen on all MIDI channels of all MIDI input
   * devices). To listen to a specific device or channel, you can use the `filter` parameter.
   *
   * WebMidi must be enabled before adding event listeners.
   *
   * Here is a list of events that are dispatched by the `WebMidi` object and that can be listened
   * to.
   *
   * MIDI interface event:
   *
   *    * {{#crossLink "WebMidi/statechange:event"}}statechange{{/crossLink}}
   *
   * Device and channel-specific MIDI events:
   *
   *    * {{#crossLink "WebMidi/noteoff:event"}}noteoff{{/crossLink}}
   *    * {{#crossLink "WebMidi/noteon:event"}}noteon{{/crossLink}}
   *    * {{#crossLink "WebMidi/keyaftertouch:event"}}keyaftertouch{{/crossLink}}
   *    * {{#crossLink "WebMidi/controlchange:event"}}controlchange{{/crossLink}}
   *    * {{#crossLink "WebMidi/channelmode:event"}}channelmode{{/crossLink}}
   *    * {{#crossLink "WebMidi/programchange:event"}}programchange{{/crossLink}}
   *    * {{#crossLink "WebMidi/channelaftertouch:event"}}channelaftertouch{{/crossLink}}
   *    * {{#crossLink "WebMidi/pitchbend:event"}}pitchbend{{/crossLink}}
   *
   * System-wide MIDI events:
   *
   *    * {{#crossLink "WebMidi/sysex:event"}}sysex{{/crossLink}}
   *    * {{#crossLink "WebMidi/timecode:event"}}timecode{{/crossLink}}
   *    * {{#crossLink "WebMidi/songposition:event"}}songposition{{/crossLink}}
   *    * {{#crossLink "WebMidi/songselect:event"}}songselect{{/crossLink}}
   *    * {{#crossLink "WebMidi/tuningrequest:event"}}tuningrequest{{/crossLink}}
   *    * {{#crossLink "WebMidi/clock:event"}}clock{{/crossLink}}
   *    * {{#crossLink "WebMidi/start:event"}}start{{/crossLink}}
   *    * {{#crossLink "WebMidi/continue:event"}}continue{{/crossLink}}
   *    * {{#crossLink "WebMidi/stop:event"}}stop{{/crossLink}}
   *    * {{#crossLink "WebMidi/activesensing:event"}}activesensing{{/crossLink}}
   *    * {{#crossLink "WebMidi/reset:event"}}reset{{/crossLink}}
   *    * {{#crossLink "WebMidi/unknownsystemmessage:event"}}unknownsystemmessage{{/crossLink}}
   *
   * For system-wide events, the `filters` parameter (if any) will be silently ignored.
   *
   * @method addListener
   * @static
   * @chainable
   *
   * @param type {String}                             The type of the event.
   * @param listener {Function}                       A callback function to execute when the
   *                                                  specified event is detected. This function
   *                                                  will receive an event parameter object.
   *                                                  For details on this object's properties,
   *                                                  check out the documentation for the various
   *                                                  events (links above).
   *
   * @param [filters={}]
   * @param [filters.device="all"] {String|Array}     The id of the MIDI device to listen on. The
   *                                                  device id can be retrieved in the
   *                                                  `WebMidi.inputs` array. It is also possible
   *                                                  to listen on several devices at once by
   *                                                  passing in an array of ids. If set to
   *                                                  'all' (default) all devices will trigger the
   *                                                  callback function.
   *
   * @param [filters.input] {MIDIInput|Array(MIDIInput)} A MIDI input device or an array of MIDI
   * input devices to listen to. As a reference, all available `MIDIInput` objects are listed in the
   * `WebMidi.inputs` array. When this parameter is left undefined, all input devices will trigger
   * the callback function.
   *
   * @param [filters.channel="all"] {uint|Array|String}  The MIDI channel to listen on (between 1 and
   *                                                  16). You can also specify an array of channels
   *                                                  to listen on. If set to 'all', all channels
   *                                                  will trigger the callback function.
   *
   * @throws {Error}                                  WebMidi must be connected before adding event
   *                                                  listeners.
   * @throws {Error}                                  There is no such input device.
   * @throws {RangeError}                             The channel must be an integer between 1 and
   *                                                  16 or the value 'all'.
   * @throws {TypeError}                              The specified event type is not supported.
   * @throws {TypeError}                              The 'listener' parameter must be a function.
   *
   * @return {WebMidi}                                Returns the `WebMidi` object so methods
   *                                                  can be chained.
   */
  WebMidi.prototype.addListener = function(type, listener, filters) {

    var that = this;

    if (!this.connected) {
      throw new Error("WebMidi must be connected before adding event listeners.");
    }

    filters = filters || {};

    if (filters.channel === undefined) { filters.channel = "all"; }
    if (filters.channel.constructor !== Array) { filters.channel = [filters.channel]; }

    filters.input = filters.input || this.inputs;
    if (filters.input.constructor !== Array) { filters.input = [filters.input]; }

    // Check if input devices are valid
    filters.input.forEach(function(item) {
      if ( !(item instanceof MIDIInput) ) {
        throw new ReferenceError("There is no such input device.");
      }
    });

    // Check if channel entries are valid
    filters.channel.forEach(function(item){
      if (item !== "all" && !(item >= 1 && item <= 16)) {
        throw new RangeError(
            "The channel must be an integer between 1 and 16 or the value 'all'."
        );
      }
    });

    if (typeof listener !== "function") {
      throw new TypeError("The 'listener' parameter must be a function.");
    }

    if (type === "statechange" || _systemMessages[type]) {

      _userHandlers.system[type].push(listener);

    } else if (_channelMessages[type]) {

      // If "all" is present anywhere in the channel array, use all 16 channels
      if (filters.channel.indexOf("all") > -1) {
        filters.channel = [];
        for (var j = 1; j <= 16; j++) { filters.channel.push(j); }
      }

      if (!_userHandlers.channel[type]) { _userHandlers.channel[type] = []; }

      // Go through all specified devices
      filters.input.forEach(function(dev) {

        // Create device array if non-existent (using the device's id)
        if ( !_userHandlers.channel[type][dev.id] ) {
          _userHandlers.channel[type][dev.id] = []; }

        // Push all channel listeners in the device array
        filters.channel.forEach(function(ch){

          if (!_userHandlers.channel[type][dev.id][ch]) {
            _userHandlers.channel[type][dev.id][ch] = [];
          }

          _userHandlers.channel[type][dev.id][ch].push(listener);

        });

      });

    } else {
      throw new TypeError("The specified event type is not supported.");
    }

    return this;

  };

  /**
   *
   * Returns a MIDIOutput or MIDIInput device matching the specified id and device type.
   *
   * @method getDeviceById
   * @static
   *
   * @param id {String}                     The id of the device. Ids can be retrieved by looking at
   *                                        the `WebMidi.inputs` or `WebMidi.outputs` arrays.
   * @param [type=input] {String}           One of 'input' or 'output' to indicate whether your are
   *                                        looking for an input or an output device.
   * @returns {MIDIOutput|MIDIInput|False}  A MIDIOutput or MIDIInput device matching the specified
   *                                        id. If no matching device can be found, the method
   *                                        returns `false`.
   */
  WebMidi.prototype.getDeviceById = function(id, type) {

    var devices = (type === "output") ? this.outputs : this.inputs;

    for (var i = 0; i < devices.length; i++) {
      if (devices[i].id === id) { return devices[i]; }
    }

    return false;

  };

  /**
   * Return the index of a device in the `WebMidi.outputs` or `WebMidi.inputs` arrays. The device
   * must be specified by using its id.
   *
   * @method getDeviceIndexById
   * @static
   *
   * @param id {String}             The id of the device such as it is presented in the
   *                                `WebMidi.inputs` or `WebMidi.outputs` arrays.
   * @param [type=input] {String}   One of 'input' or 'output' to indicate whether your are looking
   *                                for the index of an input or output device.
   * @returns {uint|False}          If no matching device can be found, the method returns `false`.
   */
  WebMidi.prototype.getDeviceIndexById = function(id, type) {

    var devices = (type === "output") ? this.outputs : this.inputs;

    for (var i = 0; i < devices.length; i++) {
      if (devices[i].id === id) { return i; }
    }

    return false;

  };

  /**
   * Checks if the specified event type is already defined to trigger the listener function on the
   * specified device and channel. If more than one device and/or channel is specified, the function
   * will return `true` only if all devices/channels have the listener defined.
   *
   * For system-wide events (`onstatechange`, `sysex`, `start`, etc.), the `filters` parameter is
   * silently ignored.
   *
   * @method hasListener
   * @static
   *
   * @param type {String}                               The type of the event.
   * @param listener {Function}                         The callback function to check for.
   * @param [filters={}] {Object}
   *
   * @param [filters.input] {MIDIInput|Array(MIDIInput)} A MIDI input device or an array of MIDI
   * input devices to check on. As a reference, all available `MIDIInput` objects are listed in the
   * `WebMidi.inputs` array. When this parameter is left undefined, all input devices will be
   * checked.
   *
   * @param [filters.channel=all] {uint|Array|String}   The MIDI channel to check on. It can be a
   *                                                    uint (between 1 and 16) or the special value
   *                                                    "all".
   *
   * @throws {Error}                                    WebMidi must be enabled before checking
   *                                                    event listeners.
   * @throws {TypeError}                                The 'listener' parameter must be a function.
   *
   * @return {Boolean}                                  Boolean value indicating whether or not the
   *                                                    channel(s) already have this listener
   *                                                    defined.
   */
  WebMidi.prototype.hasListener = function(type, listener, filters) {

    var that = this;

    if (!this.connected) {
      throw new Error("WebMidi must be connected before checking event listeners.");
    }

    if (typeof listener !== "function") {
      throw new TypeError("The 'listener' parameter must be a function.");
    }

    filters = filters || {};

    filters.input = filters.input || this.inputs;
    if (filters.input.constructor !== Array) { filters.input = [filters.input]; }

    if (filters.channel === undefined) { filters.channel = "all"; }
    if (filters.channel.constructor !== Array) { filters.channel = [filters.channel]; }

    if (type === "statechange" || _systemMessages[type]) {

      for (var o = 0; o < _userHandlers.system[type].length; o++) {
        if (_userHandlers.system[type][o] === listener) { return true; }
      }

    } else if (_channelMessages[type]) {

      // If "all" is present anywhere in the channel array, use all 16 channels
      if (filters.channel.indexOf("all") > -1) {
        filters.channel = [];
        for (var j = 1; j <= 16; j++) { filters.channel.push(j); }
      }

      if (!_userHandlers.channel[type]) { return false; }

      // Go through all specified devices
      return filters.input.every(function(dev) {

        if (!_userHandlers.channel[type][dev.id]) { return false; }

        // Go through all specified channels
        return filters.channel.every(function(chNum) {
          var listeners = _userHandlers.channel[type][dev.id][chNum];
          return listeners && listeners.indexOf(listener) > -1;
        });

      });

    }

    return false;

  };

  /**
   * Removes the specified listener from all requested input devices and channel(s). If more than
   * one devices and/or channels are specified, the function will remove the listener from all
   * devices/channels.
   *
   * For system-wide events (`onstatechange`, `sysex`, `start`, etc.), the `filters` parameter is
   * silently ignored.
   *
   * @method removeListener
   * @static
   * @chainable
   *
   * @param type {String}                         The type of the event.
   * @param listener {Function}                   The callback function to check for.
   * @param [filters={}] {Object}
   *
   * @param [filters.input] {MIDIInput|Array(MIDIInput)} A MIDI input device or an array of MIDI
   * input devices to remove from. As a reference, all available `MIDIInput` objects are listed in
   * the `WebMidi.inputs` array. When this parameter is left undefined, removal will occur for all
   * input devices.
   *
   * @param [filters.channel=all] {uint|String}   The MIDI channel(s) to check on. It can be a uint
   *                                              (between 1 and 16) or the special value "all".
   *
   * @throws {Error}                              WebMidi must be enabled before removing event
   *                                              listeners.
   *
   * @return {WebMidi}                            The `WebMidi` object for easy method chaining.
   */
  WebMidi.prototype.removeListener = function(type, listener, filters) {

    var that = this;

    if (!this.connected) {
      throw new Error("WebMidi must be connected before removing event listeners.");
    }

    filters = filters || {};

    filters.input = filters.input || this.inputs;
    if (filters.input.constructor !== Array) { filters.input = [filters.input]; }

    if (filters.channel === undefined) { filters.channel = "all"; }
    if (filters.channel.constructor !== Array) { filters.channel = [filters.channel]; }

    if (type === "statechange" || _systemMessages[type]) {

      for (var o = 0; o < _userHandlers.system[type].length; o++) {
        if (_userHandlers.system[type][o] === listener) {
          _userHandlers.system[type].splice(o, 1);
        }
      }

    } else if (_channelMessages[type]) {

      // If "all" is present anywhere in the channel array, use all 16 channels
      if (filters.channel.indexOf("all") > -1) {
        filters.channel = [];
        for (var j = 1; j <= 16; j++) { filters.channel.push(j); }
      }

      if (!_userHandlers.channel[type]) { return false; }

      // Go through all specified devices
      filters.input.forEach(function(dev) {

        if (!_userHandlers.channel[type][dev.id]) { return; }

        // Go through all specified channels
        filters.channel.forEach(function(chNum) {
          var listeners = _userHandlers.channel[type][dev.id][chNum];
          if (!listeners) { return; }
          for (var l = 0; l < listeners.length; l++) {
            if (listeners[l] === listener) { listeners.splice(l, 1); }
          }

        });

      });

    }

    return this;

  };

  /**
   * Sends a MIDI message to the specified MIDI output device(s) at the specified timestamp. The
   * `output` parameter must refer to an actual available output device or an array of output
   * devices such as those listed in the `WebMidi.outputs` array.
   *
   * Unless, you are familiar with the details of the MIDI message format, you should not use this
   * method directly. Instead, use one of the simpler helper methods: `playNote()`, `stopNote()`,
   * `sendControlChange()`, `sendSystemMessage()`, etc.
   *
   * Details on the format of MIDI messages are available in the
   * <a href="http://www.midi.org/techspecs/midimessages.php">summary of MIDI messages</a> of the
   * MIDI Manufacturers Association.
   *
   * @method send
   * @static
   * @chainable
   *
   * @param status {uint} The MIDI status byte of the message (128-255).
   *
   * @param [data=[]] {Array(int)} An array of data bytes for the message. The number of data bytes
   * varies depending on the status byte. It is perfectly legal to send no data. Each byte must be
   * between 0 and 255.
   *
   * @param [output] {MIDIOutput|Array(MIDIOutput)} A MIDI output device or an array of MIDI output
   * devices to send the message to. All available `MIDIOutput` objects are listed in the
   * `WebMidi.outputs` array. When this parameter is left undefined, the message is sent to all
   * currently available output MIDI devices.
   *
   * @param [timestamp=0] {DOMHighResTimeStamp} The timestamp at which to send the message. You can
   * use `WebMidi.time` to retrieve the current timestamp. To send immediately, leave blank or use
   * 0.
   *
   * @throws {Error} WebMidi must be connected before sending messages.
   * @throws {ReferenceError} There is no device matching the requested id.
   * @throws {RangeError} The status byte must be an integer between 128 (0x80) and 255 (0xFF).
   * @throws {RangeError} The data bytes must be integers between 0 (0x00) and 255 (0xFF).
   *
   * @return {WebMidi} Returns the `WebMidi` object so methods can be chained.
   */
  WebMidi.prototype.send = function(status, data, output, timestamp) {

    if (!this.connected) { throw new Error("WebMidi must be connected before sending messages."); }

    if (status === undefined || status < 128 || status > 255) {
      throw new RangeError("The status byte must be an integer between 128 (0x80) and 255 (0xFF).");
    }

    if (data === undefined || data.constructor !== Array) { data = []; }

    output = output || this.outputs;
    if (output.constructor !== Array) { output = [output]; }

    // Check if all output devices are actually valid
    output.forEach(function(dev) {
      if ( !(dev instanceof MIDIOutput) ) {
        throw new ReferenceError("There is no such output device.");
      }
    });

    var message = [status];

    data.forEach(function(item){
      if (item >= 0 && item <= 255) {
        message.push(item);
      } else {
        throw new RangeError("The data bytes must be integers between 0 (0x00) and 255 (0xFF).");
      }
    });

    output.forEach(function(o) {
      o.send(message, parseFloat(timestamp) || 0);
    });

    return this;

  };

  ///**
  // * Sends a MIDI real-time or common system message to all available outputs. The available
  // * messages are as follows:
  // *
  // * System common messages:
  // *
  // *    sysex
  // *    timecode
  // *    songposition
  // *    songselect
  // *    tuningrequest
  // *    sysexend
  // *
  // * System real-time messages:
  // *
  // *    clock
  // *    start
  // *    continue
  // *    stop
  // *    activesensing
  // *    reset
  // *
  // * @method sendSystemMessage
  // * @static
  // * @chainable
  // *
  // * @param command {String}    A string representing the command to send. The available system
  // *                            commands are: `sysex`, `timecode`, `songposition`, `songselect`,
  // *                            `tuningrequest`, `sysexend`, `clock`, `start`, `continue`, `stop`,
  // *                            `activesensing` and `reset`.
  // * @param [data=[]] {Array}   An array of data bytes to insert in the message. The number of data
  // *                            bytes varies depending on the command.
  // * @param [delay=0] {uint}    The number of milliseconds to wait before actually sending the
  // *                            message (using 0 will send the message immediately).
  // *
  // * @throws {Error}            WebMidi must be enabled sending messages.
  // * @throws {RangeError}       The requested system command is not supported.
  // *
  // * @return {WebMidi}          Returns the `WebMidi` object so methods can be chained.
  // *
  // */
  //WebMidi.prototype.sendSystemMessage = function(command, data, delay) {
  //
  //  if (!this.connected) { throw new Error("WebMidi must be connected sending messages."); }
  //
  //  if (!_systemMessages[command]) {
  //    throw new RangeError("The requested system command (" + command + ") is not supported");
  //  }
  //
  //  if (!data || data.constructor !== Array) { data = []; }
  //
  //  delay = parseInt(delay);
  //  if (isNaN(delay)) { delay = 0; }
  //
  //  this.send("all", _systemMessages[command], data, this.time + delay);
  //
  //  return this;
  //};

  ///**
  // * Sends a system exclusive message to all connected devices. The message will
  // * automatically be properly terminated. It is generally suggested to keep system
  // * exclusive messages to 64Kb or less.
  // *
  // * @method sendSystemMessage
  // * @static
  // * @chainable
  // *
  // * @param manufacturer {uint|Array} A uint or an array of three uints between 0 and 127
  // *                                  that identifies the targeted manufacturer.
  // * @param [data=[]] {Array}         An array of uints between 0 and 127. This is the
  // *                                  data you wish to transfer.
  // * @param [delay=0] {uint}          The number of milliseconds to wait before actually
  // *                                  sending the command (using 0 will send the command
  // *                                  immediately).
  // *
  // * @throws                          WebMidi must be enabled sending messages.
  // *
  // * @return {WebMidi}                Returns the `WebMidi` object so methods can be
  // *                                  chained.
  // */
  //WebMidi.prototype.sendSysexMessage = function(manufacturer, data, delay) {
  //
  //  if (!this.connected) {
  //    throw new Error("WebMidi must be connected before sending messages.");
  //  }
  //
  //  if (manufacturer.prototype !== Array) { manufacturer = [manufacturer]; }
  //
  //  delay = parseInt(delay);
  //  if (isNaN(delay)) { delay = 0; }
  //
  //  data = manufacturer.concat(data, _systemMessages.sysexend);
  //  this.send("all", _systemMessages.sysex, data, this.time + delay);
  //
  //  return this;
  //
  //};

  /**
   * Sends a MIDI `note off` message to the specified device(s) and channel(s) for a single note or
   * multiple simultaneous notes (chord). You can delay the execution of the `note off` command by
   * using the `delay` parameter (milliseconds).
   *
   * @method stopNote
   * @static
   * @chainable
   *
   * @param note {Array|uint|String}      The note or an array of notes to stop. The notes can be
   *                                      specified in one of two ways. The first way is by using
   *                                      the MIDI note number (an integer between 0 and 127). The
   *                                      second way is by using the note name followed by the
   *                                      octave (C3, G#4, F-1). The octave range should be between
   *                                      -2 and 8. The lowest note is C-2 (MIDI note number 0) and
   *                                      the highest note is G8 (MIDI note number 127).
   * @param [velocity=0.5] {Number}       The velocity at which to play the note (between 0 and 1).
   *                                      An invalid velocity value will silently trigger the
   *                                      default.
   *
   * @param [output] {MIDIOutput|Array(MIDIOutput)} A MIDI output device or an array of MIDI output
   * devices to send the message to. All available MIDIOutput objects are listed in the
   * `WebMidi.outputs` array. When this parameter is left undefined, the message is sent to all
   * currently available output MIDI devices.
   *
   * @param [channel="all] {uint|Array|String}  The MIDI channel number (between 1 and 16) or an
   *                                            array of channel numbers. If the special value "all"
   *                                            is used, the message will be sent to all 16
   *                                            channels.
   * @param [time=undefined] {DOMHighResTimeStamp|String}   This value can be one of two things. If
   *                                      the value is a string starting with the + sign and
   *                                      followed by a number, the request will be delayed by the
   *                                      specified number (in milliseconds). Otherwise, the value
   *                                      is considered a timestamp and the request will be
   *                                      scheduled at that timestamp. The DOMHighResTimeStamp value
   *                                      is relative to the navigation start of the document. To
   *                                      retrieve the current time, you can use `WebMidi.time`. If
   *                                      `time` is not present or is set to a time in the past,
   *                                      the request is to be sent as soon as possible.
   *
   * @throws {Error}                      WebMidi must be enabled before stopping notes.
   *
   * @return {WebMidi}                    Returns the `WebMidi` object so methods can be chained.
   */
  WebMidi.prototype.stopNote = function(note, velocity, output, channel, time) {

    var that = this;

    if (!this.connected) { throw new Error("WebMidi must be connected before stopping notes."); }

    velocity = parseFloat(velocity);
    if (isNaN(velocity) || velocity < 0 || velocity > 1) { velocity = 0.5; }

    var nVelocity = Math.round(velocity * 127);

    // Send note off messages
    this._convertNoteToArray(note).forEach(function(item) {

      that._convertChannelToArray(channel).forEach(function(ch) {
        that.send(
            (_channelMessages.noteoff << 4) + (ch - 1),
            [item, nVelocity],
            output,
            that._parseTimeParameter(time)
        );
      });

    });

    return this;

  };

  /**
   * Requests the playback of a single note or multiple notes on the specified device(s) and
   * channel(s). You can delay the execution of the `note on` command by using the `delay` parameter
   * (milliseconds).
   *
   * If no duration is specified, the note will play until a matching `note off` is sent. If a
   * duration is specified, a `note off` will be automatically executed after said duration.
   *
   * Please note that if you do use a duration, the release velocity will always be 64. If you want
   * to tailor the release velocity, you need to use separate `playNote()` and `stopNote()` calls.
   *
   * @method playNote
   * @static
   * @chainable
   *
   * @param note {Array|uint|String}      The note to play or an array of notes to play. The notes
   *                                      can be specified in one of two ways. The first way is by
   *                                      using the MIDI note number (an integer between 0 and 127).
   *                                      The second way is by using the note name followed by the
   *                                      octave (C3, G#4, F-1). The octave range should be between
   *                                      -2 and 8. The lowest possible note is C-2 and the highest
   *                                      is G8.
   * @param [velocity=0.5] {Number}       The velocity at which to play the note (between 0 and 1).
   *                                      An invalid velocity value will silently trigger the
   *                                      default.
   * @param [duration=undefined] {int}    The number of milliseconds to wait before sending a
   *                                      matching note off event. If left undefined, only a
   *                                      `note on` message is sent.
   *
   * @param [output] {MIDIOutput|Array(MIDIOutput)} A MIDI output device or an array of MIDI output
   * devices to send the message to. All available MIDIOutput objects are listed in the
   * `WebMidi.outputs` array. When this parameter is left undefined, the message is sent to all
   * currently available output MIDI devices.
   *
   * @param [channel="all] {uint|Array|String}  The MIDI channel number (between 1 and 16) or an
   *                                            array of channel numbers. If the special value "all"
   *                                            is used, the message will be sent to all 16
   *                                            channels.
   * @param [time=undefined] {DOMHighResTimeStamp|String}   This value can be one of two things. If
   *                                      the value is a string starting with the + sign and
   *                                      followed by a number, the request will be delayed by the
   *                                      specified number (in milliseconds). Otherwise, the value
   *                                      is considered a timestamp and the request will be
   *                                      scheduled at that timestamp. The DOMHighResTimeStamp value
   *                                      is relative to the navigation start of the document. To
   *                                      retrieve the current time, you can use `WebMidi.time`. If
   *                                      `time` is not present or is set to a time in the past,
   *                                      the request is to be sent as soon as possible.
   *
   * @throws {Error}                      WebMidi must be enabled before playing notes.
   *
   * @return {WebMidi}                    Returns the `WebMidi` object so methods can be chained.
   */
  WebMidi.prototype.playNote = function(note, velocity, duration, output, channel, time) {

    var that = this;

    if (!this.connected) { throw new Error("WebMidi must be connected before playing notes."); }

    velocity = parseFloat(velocity);
    if (isNaN(velocity) || velocity < 0 || velocity > 1) { velocity = 0.5; }

    var nVelocity = Math.round(velocity * 127);

    time = that._parseTimeParameter(time) || 0;

    // Send note on messages
    this._convertNoteToArray(note).forEach(function(item) {

      that._convertChannelToArray(channel).forEach(function(ch) {
        that.send(
            (_channelMessages.noteon << 4) + (ch - 1),
            [item, nVelocity],
            output,
            time
        );
      });

    });

    // Send note off messages (only if a duration has been defined)
    if (duration !== undefined) {

      this._convertNoteToArray(note).forEach(function(item) {

        that._convertChannelToArray(channel).forEach(function(ch) {
          that.send(
              (_channelMessages.noteoff << 4) + (ch - 1),
              [item, 64],
              output,
              time + duration
          );
        });

      });

    }

    return this;

  };

  /**
   * Sends a MIDI `key aftertouch` message to the specified device(s) and channel(s). This is a
   * key-specific aftertouch. For a channel-wide aftertouch message, use
   * {{#crossLink "WebMidi/sendChannelAftertouch:method"}}sendChannelAftertouch(){{/crossLink}}.
   *
   * @method sendKeyAftertouch
   * @static
   * @chainable
   *
   * @param note {Array|uint|String}  The note for which you are sending an aftertouch value. The
   *                                  notes can be specified in one of two ways. The first way is by
   *                                  using the MIDI note number (an integer between 0 and 127). The
   *                                  second way is by using the note name followed by the
   *                                  octave (C3, G#4, F-1). The octave range should be between
   *                                  -2 and 8. The lowest note is C-2 (MIDI note number 0) and
   *                                  the highest note is G8 (MIDI note number 127).
   * @param [pressure=0.5] {Number}   The pressure level to send (between 0 and 1).
   *
   * @param [output] {MIDIOutput|Array(MIDIOutput)} A MIDI output device or an array of MIDI output
   * devices to send the message to. All available MIDIOutput objects are listed in the
   * `WebMidi.outputs` array. When this parameter is left undefined, the message is sent to all
   * currently available output MIDI devices.
   *
   * @param [channel="all] {uint|Array|String}  The MIDI channel number (between 1 and 16) or an
   *                                            array of channel numbers. If the special value "all"
   *                                            is used, the message will be sent to all 16
   *                                            channels.
   * @param [time=undefined] {DOMHighResTimeStamp|String}   This value can be one of two things. If
   *                                      the value is a string starting with the + sign and
   *                                      followed by a number, the request will be delayed by the
   *                                      specified number (in milliseconds). Otherwise, the value
   *                                      is considered a timestamp and the request will be
   *                                      scheduled at that timestamp. The DOMHighResTimeStamp value
   *                                      is relative to the navigation start of the document. To
   *                                      retrieve the current time, you can use `WebMidi.time`. If
   *                                      `time` is not present or is set to a time in the past,
   *                                      the request is to be sent as soon as possible.
   *
   * @throws {Error}                  WebMidi must be enabled before sending messages.
   * @throws {RangeError}             The channel must be between 1 and 16.
   *
   * @return {WebMidi}                Returns the `WebMidi` object so methods can be chained.
   */
  WebMidi.prototype.sendKeyAftertouch = function(note, pressure, output, channel, time) {

    var that = this;

    if (!this.connected) { throw new Error("WebMidi must be connected before sending messages."); }
    if (channel < 1 || channel > 16) { throw new RangeError("The channel must be between 1 and 16."); }

    pressure = parseFloat(pressure);
    if (isNaN(pressure) || pressure < 0 || pressure > 1) { pressure = 0.5; }

    var nPressure = Math.round(pressure * 127);

    this._convertNoteToArray(note).forEach(function(item) {

      that._convertChannelToArray(channel).forEach(function(ch) {
        that.send(
            (_channelMessages.keyaftertouch << 4) + (ch - 1),
            [item, nPressure],
            output,
            that._parseTimeParameter(time)
        );
      });

    });

    return this;

  };

  /**
   * Sends a MIDI `control change` message to the specified device(s) and channel(s).
   *
   * @method sendControlChange
   * @static
   * @chainable
   *
   * @param controller {uint}             The MIDI controller number (0-119)
   * @param [value=0] {uint}              The value to send (0-127).
   *
   * @param [output] {MIDIOutput|Array(MIDIOutput)} A MIDI output device or an array of MIDI output
   * devices to send the message to. All available MIDIOutput objects are listed in the
   * `WebMidi.outputs` array. When this parameter is left undefined, the message is sent to all
   * currently available output MIDI devices.
   *
   * @param [channel="all] {uint|Array|String}  The MIDI channel number (between 1 and 16) or an
   *                                            array of channel numbers. If the special value "all"
   *                                            is used, the message will be sent to all 16
   *                                            channels.
   * @param [time=undefined] {DOMHighResTimeStamp|String}   This value can be one of two things. If
   *                                      the value is a string starting with the + sign and
   *                                      followed by a number, the request will be delayed by the
   *                                      specified number (in milliseconds). Otherwise, the value
   *                                      is considered a timestamp and the request will be
   *                                      scheduled at that timestamp. The DOMHighResTimeStamp value
   *                                      is relative to the navigation start of the document. To
   *                                      retrieve the current time, you can use `WebMidi.time`. If
   *                                      `time` is not present or is set to a time in the past,
   *                                      the request is to be sent as soon as possible.
   *
   * @throws {Error}                      WebMidi must be enabled before sending messages.
   * @throws {RangeError}                 Controller numbers must be between 0 and 119.
   * @throws {RangeError}                 Value must be between 0 and 127.
   *
   * @return {WebMidi}                    Returns the `WebMidi` object so methods can be chained.
   */
  WebMidi.prototype.sendControlChange = function(controller, value, output, channel, time) {

    var that = this;

    if (!this.connected) { throw new Error("WebMidi must be connected before sending messages."); }

    controller = parseInt(controller);
    if (isNaN(controller) || controller < 0 || controller > 119) {
      throw new RangeError("Controller numbers must be between 0 and 119.");
    }

    value = parseInt(value);
    if (isNaN(value) || value < 0 || value > 127) {
      throw new RangeError("Value must be between 0 and 127");
    }

    this._convertChannelToArray(channel).forEach(function(ch) {
      that.send(
          (_channelMessages.controlchange << 4) + (ch - 1),
          [controller, value],
          output,
          that._parseTimeParameter(time)
      );
    });

    return this;

  };

  /**
   * Sends a series of MIDI RPN message (registered parameter number) to the specified device(s) and
   * channel(s) so that they adjust their pitch bend range. The range can be specified with the
   * semitones parameter, the cents parameter or by specifying both parameters at the same time.
   *
   * @method setPitchBendRange
   * @static
   * @chainable
   *
   * @param [semitones] {uint} The desired adjustment value in semitones (0-127). While nothing
   * imposes that in the specification, it is very common for manufacturers to limit the range to 2
   * octaves (-12 semitones to 12 semitones).
   *
   * @param [cents=0] {uint} The desired adjustment value in cents (0-127).
   *
   * @param [output] {MIDIOutput|Array(MIDIOutput)} A MIDI output device or an array of MIDI output
   * devices to send the message to. All available MIDIOutput objects are listed in the
   * `WebMidi.outputs` array. When this parameter is left undefined, the message is sent to all
   * currently available output MIDI devices.
   *
   * @param [channel="all] {uint|Array|String}  The MIDI channel number (between 1 and 16) or an
   * array of channel numbers. If the special value "all" is used, the message will be sent to all
   * 16 channels.
   *
   * @param [time=undefined] {DOMHighResTimeStamp|String}   This value can be one of two things. If
   * the value is a string starting with the + sign and followed by a number, the request will be
   * delayed by the specified number (in milliseconds). Otherwise, the value is considered a
   * timestamp and the request will be scheduled at that timestamp. The DOMHighResTimeStamp value is
   * relative to the navigation start of the document. To retrieve the current time, you can use
   * `WebMidi.time`. If `time` is not present or is set to a time in the past, the request is to be
   * sent as soon as possible.
   *
   * @throws {Error} WebMidi must be enabled before sending messages.
   * @throws {RangeError} The semitones value must be between 0 and 127.
   * @throws {RangeError} The cents value must be between 0 and 127.
   *
   * @return {WebMidi} Returns the `WebMidi` object so methods can be chained.
   */
  WebMidi.prototype.setPitchBendRange = function(semitones, cents, output, channel, time) {

    var that = this;

    if (!this.connected) {
      throw new Error("WebMidi must be connected before sending messages.");
    }

    semitones = parseInt(semitones);
    if (isNaN(semitones) || semitones < 0 || semitones > 127) {
      throw new RangeError("The semitones value must be between 0 and 127");
    }

    cents = parseInt(cents);
    if (isNaN(cents) || cents < 0 || cents > 127) {
      throw new RangeError("The cents value must be between 0 and 127");
    }

    this._convertChannelToArray(channel).forEach(function(ch) {
      that.sendControlChange(0x65, 0x0, output, channel, time); // MSB
      that.sendControlChange(0x64, 0x0, output, channel, time); // LSB
      that.sendControlChange(0x06, semitones, output, channel, time); // Data Entry Coarse
      that.sendControlChange(0x26, cents, output, channel, time); // Data Entry Fine
      that.sendControlChange(0x65, 0x7F, output, channel, time); // Nulling the active parameter
      that.sendControlChange(0x64, 0x7F, output, channel, time); // Nulling the active parameter
    });

    return this;

  };

  /**
   * Sends a series of MIDI RPN message (registered parameter number) to the specified device(s) and
   * channel(s) so that they adjust the depth of the modulation wheel's range. The range can be
   * specified with the semitones parameter, the cents parameter or by specifying both parameters at
   * the same time.
   *
   * @method setModulationRange
   * @static
   * @chainable
   *
   * @param [semitones] {uint} The desired adjustment value in semitones (0-127).
   *
   * @param [cents=0] {uint} The desired adjustment value in cents (0-127).
   *
   * @param [output] {MIDIOutput|Array(MIDIOutput)} A MIDI output device or an array of MIDI output
   * devices to send the message to. All available MIDIOutput objects are listed in the
   * `WebMidi.outputs` array. When this parameter is left undefined, the message is sent to all
   * currently available output MIDI devices.
   *
   * @param [channel="all] {uint|Array|String}  The MIDI channel number (between 1 and 16) or an
   * array of channel numbers. If the special value "all" is used, the message will be sent to all
   * 16 channels.
   *
   * @param [time=undefined] {DOMHighResTimeStamp|String}   This value can be one of two things. If
   * the value is a string starting with the + sign and followed by a number, the request will be
   * delayed by the specified number (in milliseconds). Otherwise, the value is considered a
   * timestamp and the request will be scheduled at that timestamp. The DOMHighResTimeStamp value is
   * relative to the navigation start of the document. To retrieve the current time, you can use
   * `WebMidi.time`. If `time` is not present or is set to a time in the past, the request is to be
   * sent as soon as possible.
   *
   * @throws {Error} WebMidi must be enabled before sending messages.
   * @throws {RangeError} The semitones value must be between 0 and 127.
   * @throws {RangeError} The cents value must be between 0 and 127.
   *
   * @return {WebMidi} Returns the `WebMidi` object so methods can be chained.
   */
  WebMidi.prototype.setModulationRange = function(semitones, cents, output, channel, time) {

    var that = this;

    if (!this.connected) {
      throw new Error("WebMidi must be connected before sending messages.");
    }

    semitones = parseInt(semitones);
    if (isNaN(semitones) || semitones < 0 || semitones > 127) {
      throw new RangeError("The semitones value must be between 0 and 127");
    }

    cents = parseInt(cents);
    if (isNaN(cents) || cents < 0 || cents > 127) {
      throw new RangeError("The cents value must be between 0 and 127");
    }

    this._convertChannelToArray(channel).forEach(function(ch) {
      that.sendControlChange(0x65, 0x5, output, channel, time); // MSB
      that.sendControlChange(0x64, 0x0, output, channel, time); // LSB
      that.sendControlChange(0x06, semitones, output, channel, time); // Data Entry Coarse
      that.sendControlChange(0x26, cents, output, channel, time); // Data Entry Fine
      that.sendControlChange(0x65, 0x7F, output, channel, time); // Nulling the active parameter
      that.sendControlChange(0x64, 0x7F, output, channel, time); // Nulling the active parameter
    });

    return this;

  };

  /**
   * Sends a series of MIDI RPN messages (registered parameter number) to the specified device(s)
   * and channel(s) so that they adjust their master tuning setting. The value can be decimal and
   * must be larger than -65 semitones and smaller than 64 semitones.
   *
   * Because of the way the MIDI specification works, the decimal portion of the value will be
   * encoded with a resolution of 14bit. The integer portion must be between -64 and 63 (inclusive).
   * For those familiar with the MIDI protocol, this function generates Master Coarse Tuning and
   * Master Fine Tuning RPN messages.
   *
   * @method setMasterTuning
   * @static
   * @chainable
   *
   * @param [value] {Number} The desired decimal adjustment value in semitones (-65 < x < 64)
   *
   * @param [output] {MIDIOutput|Array(MIDIOutput)} A MIDI output device or an array of MIDI output
   * devices to send the message to. All available MIDIOutput objects are listed in the
   * `WebMidi.outputs` array. When this parameter is left undefined, the message is sent to all
   * currently available output MIDI devices.
   *
   * @param [channel="all] {uint|Array|String}  The MIDI channel number (between 1 and 16) or an
   * array of channel numbers. If the special value "all" is used, the message will be sent to all
   * 16 channels.
   *
   * @param [time=undefined] {DOMHighResTimeStamp|String}   This value can be one of two things. If
   * the value is a string starting with the + sign and followed by a number, the request will be
   * delayed by the specified number (in milliseconds). Otherwise, the value is considered a
   * timestamp and the request will be scheduled at that timestamp. The DOMHighResTimeStamp value is
   * relative to the navigation start of the document. To retrieve the current time, you can use
   * `WebMidi.time`. If `time` is not present or is set to a time in the past, the request is to be
   * sent as soon as possible.
   *
   * @throws {Error} WebMidi must be enabled before sending messages.
   *
   * @throws {RangeError} The value must be a decimal number between larger than -128 and smaller
   * than 128.
   *
   * @return {WebMidi} Returns the `WebMidi` object so methods can be chained.
   */
  WebMidi.prototype.setMasterTuning = function(value, output, channel, time) {

    var that = this;

    if (!this.connected) {
      throw new Error("WebMidi must be connected before sending messages.");
    }

    value = parseFloat(value) || 0;

    if (value <= -65 || value >= 64) {
      throw new RangeError(
          "The value must be a decimal number larger than -65 and smaller than 64."
      );
    }

    var coarse = parseInt(value) + 64;
    var fine = value - parseInt(value);

    // Calculate MSB and LSB for fine adjustment (14bit resolution)
    fine = Math.round((fine + 1) / 2 * 16383);
    var msb = (fine >> 7) & 0x7F;
    var lsb = fine & 0x7F;

    this._convertChannelToArray(channel).forEach(function(ch) {

      // Send "coarse" adjustment
      that.sendControlChange(0x65, 0x0, output, channel, time); // CC MSB
      that.sendControlChange(0x64, 0x2, output, channel, time); // CC LSB
      that.sendControlChange(0x06, coarse, output, channel, time); // Data Entry Coarse
      that.sendControlChange(0x65, 0x7F, output, channel, time); // Nulling the active parameter
      that.sendControlChange(0x64, 0x7F, output, channel, time); // Nulling the active parameter

      // Send "fine" adjustment
      that.sendControlChange(0x65, 0x0, output, channel, time); // CC MSB
      that.sendControlChange(0x64, 0x1, output, channel, time); // CC LSB
      that.sendControlChange(0x06, msb, output, channel, time); // Data Entry Coarse
      that.sendControlChange(0x26, lsb, output, channel, time); // Data Entry Fine
      that.sendControlChange(0x65, 0x7F, output, channel, time); // Nulling the active parameter
      that.sendControlChange(0x64, 0x7F, output, channel, time); // Nulling the active parameter

    });

    return this;

  };

  // tuning program change setTuningProgram()
  // tuning bank select setTuningBank()
  // resetRpn()
  // setRegisteredParameter(cc65, cc64, msb, lsb, output, channel, time);

  /**
   * Sends a MIDI `channel mode` message to the specified device(s) and channel(s).
   *
   * @method sendChannelMode
   * @static
   * @chainable
   *
   * @param command {uint}                The MIDI channel mode command (120-127).
   * @param value {uint}                  The value to send (0-127)
   *
   * @param [output] {MIDIOutput|Array(MIDIOutput)} A MIDI output device or an array of MIDI output
   * devices to send the message to. All available MIDIOutput objects are listed in the
   * `WebMidi.outputs` array. When this parameter is left undefined, the message is sent to all
   * currently available output MIDI devices.
   *
   * @param [channel="all] {uint|Array|String}  The MIDI channel number (between 1 and 16) or an
   *                                            array of channel numbers. If the special value "all"
   *                                            is used, the message will be sent to all 16
   *                                            channels.
   * @param [time=undefined] {DOMHighResTimeStamp|String}   This value can be one of two things. If
   *                                      the value is a string starting with the + sign and
   *                                      followed by a number, the request will be delayed by the
   *                                      specified number (in milliseconds). Otherwise, the value
   *                                      is considered a timestamp and the request will be
   *                                      scheduled at that timestamp. The DOMHighResTimeStamp value
   *                                      is relative to the navigation start of the document. To
   *                                      retrieve the current time, you can use `WebMidi.time`. If
   *                                      `time` is not present or is set to a time in the past,
   *                                      the request is to be sent as soon as possible.
   *
   * @throws {Error}                      WebMidi must be enabled before sending messages.
   * @throws {RangeError}                 Channel mode controller numbers must be between 120 and
   *                                      127.
   * @throws {RangeError}                 Value must be between 0 and 127.
   *
   * @return {WebMidi}                    Returns the `WebMidi` object so methods can be chained.
   *
   */
  WebMidi.prototype.sendChannelMode = function(command, value, output, channel, time) {

    var that = this;

    if (!this.connected) { throw new Error("WebMidi must be connected before sending messages"); }

    command = parseInt(command);
    if (isNaN(command) || command < 120 || command > 127) {
      throw new RangeError("Channel mode commands must be between 120 and 127.");
    }

    value = parseInt(value);
    if (isNaN(value) || value < 0 || value > 127) {
      throw new RangeError("Value must be integers between 0 and 127.");
    }

    this._convertChannelToArray(channel).forEach(function(ch) {

      that.send(
          (_channelMessages.channelmode << 4) + (ch - 1),
          [command, value],
          output,
          that._parseTimeParameter(time)
      );

    });

    return this;

  };

  /**
   * Sends a MIDI `program change` message to the specified device(s) and channel(s).
   *
   * @method sendProgramChange
   * @static
   * @chainable
   *
   * @param program {uint}                The MIDI patch (program) number (0-127)
   *
   * @param [output] {MIDIOutput|Array(MIDIOutput)} A MIDI output device or an array of MIDI output
   * devices to send the message to. All available MIDIOutput objects are listed in the
   * `WebMidi.outputs` array. When this parameter is left undefined, the message is sent to all
   * currently available output MIDI devices.
   *
   * @param [channel="all] {uint|Array|String}  The MIDI channel number (between 1 and 16) or an
   *                                            array of channel numbers. If the special value "all"
   *                                            is used, the message will be sent to all 16
   *                                            channels.
   * @param [time=undefined] {DOMHighResTimeStamp|String}   This value can be one of two things. If
   *                                      the value is a string starting with the + sign and
   *                                      followed by a number, the request will be delayed by the
   *                                      specified number (in milliseconds). Otherwise, the value
   *                                      is considered a timestamp and the request will be
   *                                      scheduled at that timestamp. The DOMHighResTimeStamp value
   *                                      is relative to the navigation start of the document. To
   *                                      retrieve the current time, you can use `WebMidi.time`. If
   *                                      `time` is not present or is set to a time in the past,
   *                                      the request is to be sent as soon as possible.
   *
   * @throws {Error}                      WebMidi must be enabled before sending messages.
   * @throws {RangeError}                 Program numbers must be between 0 and 127.
   *
   * @return {WebMidi}                    Returns the `WebMidi` object so methods can be chained.
   *
   */
  WebMidi.prototype.sendProgramChange = function(program, output, channel, time) {

    var that = this;

    if (!this.connected) { throw new Error("WebMidi must be connected before sending messages."); }

    program = parseInt(program);
    if (isNaN(program) || program < 0 || program > 127) {
      throw new RangeError("Program numbers must be between 0 and 127.");
    }

    this._convertChannelToArray(channel).forEach(function(ch) {
      that.send(
          (_channelMessages.programchange << 4) + (ch - 1),
          [program],
          output,
          that._parseTimeParameter(time)
      );
    });

    return this;

  };

  /**
   * Sends a MIDI `channel aftertouch` message to the specified device(s) and channel(s). For
   * key-specific aftertouch, you should instead use `sendKeyAftertouch()`.
   *
   * @method sendChannelAftertouch
   * @static
   * @chainable
   *
   * @param [pressure=0.5] {Number}       The pressure level (between 0 and 1). An invalid pressure
   *                                      value will silently trigger the default behaviour.
   *
   * @param [output] {MIDIOutput|Array(MIDIOutput)} A MIDI output device or an array of MIDI output
   * devices to send the message to. All available MIDIOutput objects are listed in the
   * `WebMidi.outputs` array. When this parameter is left undefined, the message is sent to all
   * currently available output MIDI devices.
   *
   * @param [channel="all] {uint|Array|String}  The MIDI channel number (between 1 and 16) or an
   *                                            array of channel numbers. If the special value "all"
   *                                            is used, the message will be sent to all 16
   *                                            channels.
   * @param [time=undefined] {DOMHighResTimeStamp|String}   This value can be one of two things. If
   *                                      the value is a string starting with the + sign and
   *                                      followed by a number, the request will be delayed by the
   *                                      specified number (in milliseconds). Otherwise, the value
   *                                      is considered a timestamp and the request will be
   *                                      scheduled at that timestamp. The DOMHighResTimeStamp value
   *                                      is relative to the navigation start of the document. To
   *                                      retrieve the current time, you can use `WebMidi.time`. If
   *                                      `time` is not present or is set to a time in the past,
   *                                      the request is to be sent as soon as possible.
   *
   * @throws {Error}                      WebMidi must be enabled before sending messages.
   *
   * @return {WebMidi}                    Returns the `WebMidi` object so methods can be chained.
   */
  WebMidi.prototype.sendChannelAftertouch = function(pressure, output, channel, time) {

    var that = this;

    if (!this.connected) { throw new Error("WebMidi must be connected before sending messages."); }

    pressure = parseFloat(pressure);
    if (isNaN(pressure) || pressure < 0 || pressure > 1) { pressure = 0.5; }

    var nPressure = Math.round(pressure * 127);

    this._convertChannelToArray(channel).forEach(function(ch) {
      that.send(
          (_channelMessages.channelaftertouch << 4) + (ch - 1),
          [nPressure],
          output,
          that._parseTimeParameter(time)
      );
    });

    return this;

  };

  /**
   * Sends a MIDI `pitch bend` message to the specified device(s) and channel(s).
   *
   * @method sendPitchBend
   * @static
   * @chainable
   *
   * @param bend {Number} The intensity level of the bend (between -1 and 1). A value of zero means
   * no bend.
   *
   * @param [output] {MIDIOutput|Array(MIDIOutput)} A MIDI output device or an array of MIDI output
   * devices to send the message to. All available MIDIOutput objects are listed in the
   * `WebMidi.outputs` array. When this parameter is left undefined, the message is sent to all
   * currently available output MIDI devices.
   *
   * @param [channel="all] {uint|Array|String}  The MIDI channel number (between 1 and 16) or an
   * array of channel numbers. If the special value "all" is used, the message will be sent to all
   * 16 channels.
   *
   * @param [time=undefined] {DOMHighResTimeStamp|String} This value can be one of two things. If
   * the value is a string starting with the + sign and followed by a number, the request will be
   * delayed by the specified number (in milliseconds). Otherwise, the value is considered a
   * timestamp and the request will be scheduled at that timestamp. The DOMHighResTimeStamp value is
   * relative to the navigation start of the document. To retrieve the current time, you can use
   * `WebMidi.time`. If `time` is not present or is set to a time in the past, the request is to be
   * sent as soon as possible.
   *
   * @throws {Error}                      WebMidi must be enabled before sending messages.
   * @throws {RangeError}                 Pitch bend value must be between -1 and 1.
   *
   * @return {WebMidi}                    Returns the `WebMidi` object so methods can be chained.
   */
  WebMidi.prototype.sendPitchBend = function(bend, output, channel, time) {

    var that = this;

    if (!this.connected) { throw new Error("WebMidi must be connected before sending messages."); }

    bend = parseFloat(bend);
    if (isNaN(bend) || bend < -1 || bend > 1) {
      throw new RangeError("Pitch bend value must be between -1 and 1.");
    }

    var nLevel = Math.round((bend + 1) / 2 * 16383);
    var msb = (nLevel >> 7) & 0x7F;
    var lsb = nLevel & 0x7F;

    this._convertChannelToArray(channel).forEach(function(ch) {
      that.send(
          (_channelMessages.pitchbend << 4) + (ch - 1),
          [lsb, msb],
          output,
          that._parseTimeParameter(time)
      );
    });

    return this;

  };

  /**
   * Returns a valid MIDI note number given the specified input. The input can be an integer
   * represented as a string, a note name (C3, F#4, D-2, G8, etc.), a float or an int between 0 and
   * 127.
   *
   * @param input         A integer, float or string to extract the note number from.
   * @throws {Error}      Invalid note number.
   * @returns {uint}      A valid MIDI note number (0-127).
   */
  WebMidi.prototype.guessNoteNumber = function(input) {

    var output = false;

    if (input && input.toFixed && input >= 0 && input <= 127) {         // uint
      output = input;
    } else if (parseInt(input) >= 0 && parseInt(input) <= 127) {        // uint as string
      output = parseInt(input);
    } else if (typeof input === 'string' || input instanceof String) {  // string
      output = this.noteNameToNumber(input);
    }

    if (output === false) {
      throw new Error("Invalid note number (" + input + ").");
    } else {
      return output;
    }

  };

  /**
   * Returns a MIDI note number matching the note name passed in the form of a string parameter. The
   * note name must include the octave number which should be between -2 and 8: C5, G4, D#-1, F0,
   * etc.
   *
   * The lowest note is C-2 (MIDI note number 0) and the highest note is G8 (MIDI note number 127).
   *
   * @method noteNameToNumber
   * @static
   *
   * @param name {String}   The name of the note in the form of a letter, followed by an optional #
   * symbol, followed by the octave number (between -2 and 8).
   *
   * @return {uint}         The MIDI note number (between 0 and 127)
   */
  WebMidi.prototype.noteNameToNumber = function(name) {

    var matches = name.match(/([CDEFGAB]#?)(-?\d+)/i);
    if(!matches) { throw new RangeError("Invalid note name."); }

    var number = _notes.indexOf(matches[1].toUpperCase());
    var octave = parseInt(matches[2]);
    var result = ((octave + 2) * 12) + number;

    if (number < 0 || octave < -2 || octave > 8 || result < 0 || result > 127) {
      throw new RangeError("Invalid note name or note outside valid range.");
    }

    return result;

  };

  /**
   * Converts an input value (which can be an int, an array or the value "all" to an array of valid
   * MIDI note numbers.
   *
   * @method _convertNoteToArray
   * @param [note] {uint|Array|String}
   * @private
   */
  WebMidi.prototype._convertNoteToArray = function(note) {

    var that = this,
        notes = [];

    if ( !Array.isArray(note) ) { note = [note]; }

    note.forEach(function(item) {
      notes.push(that.guessNoteNumber(item));
    });

    return notes;

  };

  /**
   * Converts an input value (which can be an int, an array or the value "all" to an array of valid
   * MIDI channels. If "undefined" is provided as the channel, an array of all channels will be
   * returned.
   *
   * @method _convertChannelToArray
   * @param [channel] {uint|Array}
   * @private
   */
  WebMidi.prototype._convertChannelToArray = function(channel) {

    if (channel === 'all' || channel === undefined) { channel = ['all']; }

    if ( !Array.isArray(channel) ) { channel = [channel]; }

    if (channel.indexOf('all') > -1) {
      channel = [];
      for (var i = 1; i <= 16; i++) { channel.push(i); }
    }

    channel.forEach(function(ch) {
      if ( !(ch >= 1 && ch <= 16) ) {
        throw new RangeError("MIDI channels must be between 1 and 16.");
      }
    });

    return channel;

  };

  /**
   *
   * @method _parseTimeParameter
   * @param [time=0] {Number|String}
   * @private
   */
  WebMidi.prototype._parseTimeParameter = function(time) {

    if (time && time.substring && time.substring(0, 1) === "+") {
      return (parseFloat(time) + this.time) || undefined;
    } else {
      return parseFloat(time) || undefined;
    }

  };

  // Check if RequireJS/AMD is used. If it is, use it to define our module instead of
  // polluting the global space.
  if ( typeof define === "function" && typeof define.amd === "object") {
    define([], function () {
      return new WebMidi();
    });
  } else if (typeof module !== "undefined" && module.exports) {
    module.exports = WebMidi;
  } else {
    if (!scope.WebMidi) { scope.WebMidi = new WebMidi(); }
  }

}(this));