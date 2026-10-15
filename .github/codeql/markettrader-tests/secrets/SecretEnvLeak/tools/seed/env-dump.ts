declare const env: { DATABASE_URL: string };

// OK: tools/ is outside application source.
console.log(env.DATABASE_URL);
