Package.describe({
  name: "refapp:meteor-typescript-compiler",
  version: "0.0.1",
  summary: "A Typescript compiler plugin for Meteor",
  git: "https://github.com/ref-app/meteor-typescript-compiler",
  documentation: "README.md",
});

Npm.depends({
  typescript: "3.9.2",
  chalk: "4.0.0",
  "@types/node": "14.0.4",
});

Package.onUse(function (api) {
  api.versionsFrom("1.10");
  api.use(["babel-compiler"], "server");
  api.use(["typescript"], "server"); // For compiling this package, should be a "devDependency"
  api.addFiles(["meteor-typescript-compiler.ts"], "server");
  api.export(["MeteorTypescriptCompiler"], "server");
});

Package.onTest(function (api) {
  api.use("tinytest");
  api.use("typescript");
  api.use("refapp:meteor-typescript-compiler");
  api.mainModule("tests.ts");
});
