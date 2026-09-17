import nextPlugin from "@next/eslint-plugin-next";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "public/**",
      "dist/**",
      ".system_generated/**",
    ],
  },
  nextPlugin.configs["core-web-vitals"],
];

export default eslintConfig;
