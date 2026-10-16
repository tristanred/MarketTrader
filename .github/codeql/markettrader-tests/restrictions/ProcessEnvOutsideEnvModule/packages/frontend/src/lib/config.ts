export const mode = process.env.NODE_ENV; // BAD: the frontend uses import.meta.env
export const viteMode = import.meta.env.MODE; // OK
