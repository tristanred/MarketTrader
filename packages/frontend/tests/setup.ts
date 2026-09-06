import '@testing-library/jest-dom';

// jsdom ships none of these, and Radix's floating layers (Popover) plus the
// note popover's pointer-capture resize grip both reach for them on mount.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const elementProto = Element.prototype as unknown as Record<string, unknown>;
elementProto['setPointerCapture'] ??= function () {};
elementProto['releasePointerCapture'] ??= function () {};
elementProto['hasPointerCapture'] ??= function () {
  return false;
};
