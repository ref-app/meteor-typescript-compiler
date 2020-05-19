var MeteorTypescriptCompiler = class MeteorTypescriptCompiler {
  constructor() {
    console.log("MeteorTypescriptCompiler constructor called");
  }
  processFilesForTarget(inputFiles) {
    console.log("processFilesForTarget called");
    for (const inputFile of inputFiles) {
      console.log(inputFile.getPathInPackage());
    }
  }
};
