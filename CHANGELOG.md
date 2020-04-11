# Changelog

Starting with version 3.x, all notable changes to WebMidi.js will be documented in this file. The 
format used is the one suggested by [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [3.0.0]

### Added

- The `WebMidi.enabled()` method now returns a promise. The promise is fulfilled with an object 
referencing the available inputs and outputs.

- `Input` and `Output` objects now emit `opened`, `closed` and `disconnected` events.

- All emitted events now have a `target` property referencing the object that triggered the event.

- A CHANGELOG.md file was added to the project to trach changes.

### Changed

- All non-chainable methods now return `false` instead of returning `undefined` or throwing an error
when invalid input is provided. Methods that were changed to match this behaviour are 
`WebMidi.guessNoteNumber()`, `WebMidi.getOctave()`, `WebMidi.getNoteNumberByName()`, 
`Input.getCcNameByNumber()`, `Input.getChannelModeByNumber()`

- Documentation is now generated with [jsdoc](https://www.npmjs.com/package/jsdoc) instead of the 
outdated [yuidoc](https://www.npmjs.com/package/grunt-contrib-yuidoc).

- Grunt has been replaced with NPM scripts for all build purposes.

### Deprecated

- The name of the `WebMidi.noteNameToNumber()` method was changed to 
`WebMidi.getNoteNumberByName()`. The old name has been deprecated but will continue to work in v3.x.

- The name of the `WebMidi.toMIDIChannels()` method was changed to `WebMidi.sanitizeChannels()`. The
old name has been deprecated but will continue to work in v3.x.

- The name of the `Output.sendTuningRequest()` method was changed to `Output.sendTuneRequest()`. The
old name has been deprecated but will continue to work in v3.x.

- The name of the `WebMidi.MIDI_CHANNEL_MESSAGES` enum was changed to 
`WebMidi.MIDI_CHANNEL_VOICE_MESSAGES`. The old name has been deprecated but will continue to work in
v3.x.

### Removed

- Support for Bower.

### Fixed

## [2.5.1] - 2019-08-25

Versions 2.5.x and earlier have not been tracked in this changelog.