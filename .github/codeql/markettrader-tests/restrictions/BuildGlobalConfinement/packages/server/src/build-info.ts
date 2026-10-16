declare const __APP_VERSION__: string | undefined;
declare const __GIT_COMMIT__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

export const buildInfo = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev', // OK
  commit: typeof __GIT_COMMIT__ !== 'undefined' ? __GIT_COMMIT__ : 'dev', // OK
  buildTime: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : new Date().toISOString(), // OK
};

export function guardedIf(): string {
  if (typeof __APP_VERSION__ === 'string') {
    return __APP_VERSION__; // OK: inside the guarded branch
  }
  return typeof __GIT_COMMIT__ === 'string' && __GIT_COMMIT__ ? __GIT_COMMIT__ : 'x'; // OK
}

export const flipped = typeof __APP_VERSION__ === 'undefined' ? 'x' : __APP_VERSION__; // OK: read in the defined branch
export const negated = !(typeof __GIT_COMMIT__ === 'string') ? 'x' : __GIT_COMMIT__; // OK
export const orElse = typeof __BUILD_TIME__ === 'undefined' || __BUILD_TIME__.length > 0; // OK

export function earlyReturn(): string {
  if (typeof __APP_VERSION__ !== 'string') {
    return 'dev';
  }
  return __APP_VERSION__; // OK: the early return guards the rest of the block
}

export function elseBranch(): string {
  if (typeof __GIT_COMMIT__ === 'undefined') return 'dev';
  else return __GIT_COMMIT__; // OK
}

export function noExit(): string {
  if (typeof __APP_VERSION__ !== 'string') {
    console.log('missing');
  }
  return __APP_VERSION__; // BAD: the guard does not leave the block
}

export const bare = __BUILD_TIME__; // BAD: throws under tsx watch
export const inverted = typeof __APP_VERSION__ === 'undefined' ? __APP_VERSION__ : 'x'; // BAD: guard polarity is wrong
export const wrongName = typeof __GIT_COMMIT__ === 'string' ? __APP_VERSION__ : 'x'; // BAD: guard tests another global
