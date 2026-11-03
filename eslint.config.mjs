import nextVitals from "eslint-config-next/core-web-vitals";
export default [
  ...nextVitals,
  { ignores: [".next/**", "node_modules/**", "flutter_app/**", "playwright-report/**", "test-results/**"] },
];
