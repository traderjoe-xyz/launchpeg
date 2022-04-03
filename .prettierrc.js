module.exports = {
  overrides: [
    {
      files: "*.sol",
      options: {
        bracketSpacing: false,
        printWidth: 80,
        tabWidth: 4,
        useTabs: false,
        singleQuote: false,
        explicitTypes: "always",
      },
    },
    {
      files: "*.ts",
      options: {
        printWidth: 120,
        singleQuote: true,
        semi: false,
        trailingComma: "es5",
      },
    },
  ],
};
