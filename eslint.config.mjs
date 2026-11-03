import nextVitals from "eslint-config-next/core-web-vitals";
export default [
  ...nextVitals,
  // These standalone browser scripts use local business module identifiers;
  // they are not CommonJS modules or Next.js bundles.
  { files: ["public/petrosoft-assets/*.js"], rules: { "@next/next/no-assign-module-variable": "off" } },
  { ignores: [".next/**", "node_modules/**", "flutter_app/**", "playwright-report/**", "test-results/**"] },
];
