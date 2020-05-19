Package.describe({
  name: "refapp:meteor-typescript-compiler",
  version: "0.0.1",
  summary: "A Typescript compiler plugin for Meteor",
  git: "https://github.com/ref-app/meteor-typescript-compiler",
  documentation: "README.md",
});

Npm.depends({
  typescript: "3.9.2",
});

Package.onUse(function (api) {
  api.versionsFrom("1.10");
  api.use("ecmascript", "server");
  api.use("typescript", "server");
  api.addFiles(["meteor-typescript-compiler.ts"], "server");
  api.export(["MeteorTypescriptCompiler"], "server");
});
