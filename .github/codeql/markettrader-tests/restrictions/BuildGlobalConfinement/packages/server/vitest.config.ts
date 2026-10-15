// OK: build config defines the globals; not application source.
declare const __APP_VERSION__: string;
export default { define: { __APP_VERSION__: JSON.stringify('1.0.0') }, v: __APP_VERSION__ };
