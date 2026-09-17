/**
 * Narrow replay command contract for presentation code.
 *
 * The UI knows only the user intents exposed here. The application layer owns
 * command policy, serialization, validation, and the replay engine itself.
 */

const REQUIRED_COMMANDS = Object.freeze([
  'togglePlayPause',
  'pause',
  'stepForward',
  'reset',
  'setSpeed',
]);

export function assertReplayCommandPresentationPort(commands) {
  if (!commands || typeof commands !== 'object') {
    throw new TypeError('replay command presentation port requires an object');
  }
  for (const name of REQUIRED_COMMANDS) {
    if (typeof commands[name] !== 'function') {
      throw new TypeError(`replay command presentation port requires ${name}()`);
    }
  }
  return commands;
}

export function createReplayCommandPresentationPort(controller) {
  if (!controller || typeof controller !== 'object') {
    throw new TypeError('createReplayCommandPresentationPort requires a command owner');
  }
  const commands = Object.fromEntries(REQUIRED_COMMANDS.map((name) => [name, (...args) => controller[name](...args)]));
  return Object.freeze(commands);
}
