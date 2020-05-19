import * as ts from "typescript";

export class MeteorTypescriptCompilerImpl {
  private program: ts.EmitAndSemanticDiagnosticsBuilderProgram;
  private diagnostics: ts.Diagnostic[];

  constructor() {
    console.log("MeteorTypescriptCompiler constructor called");
  }

  startIncrementalCompilation() {
    const configPath = ts.findConfigFile(
      /*searchPath*/ "./",
      ts.sys.fileExists,
      "tsconfig.json"
    );
    if (!configPath) {
      throw new Error("Could not find a valid 'tsconfig.json'.");
    }

    const buildInfoFile = ts.sys.resolvePath("./buildfile.tsbuildinfo");
    const config = ts.getParsedCommandLineOfConfigFile(
      configPath,
      /*optionsToExtend*/ {
        incremental: true,
        tsBuildInfoFile: buildInfoFile,
      },
      /*host*/ {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (d) =>
          console.error(ts.flattenDiagnosticMessageText(d.messageText, "\n")),
      }
    );
    if (!config) {
      throw new Error("Could not parse 'tsconfig.json'.");
    }

    this.program = ts.createIncrementalProgram({
      rootNames: config.fileNames,
      options: config.options,
      configFileParsingDiagnostics: ts.getConfigFileParsingDiagnostics(config),
      projectReferences: config.projectReferences,
      // createProgram can be passed in here to choose strategy for incremental compiler just like when creating incremental watcher program.
      // Default is ts.createSemanticDiagnosticsBuilderProgram
    });
    this.diagnostics = [
      ...this.program.getConfigFileParsingDiagnostics(),
      ...this.program.getSyntacticDiagnostics(),
      ...this.program.getOptionsDiagnostics(),
      ...this.program.getGlobalDiagnostics(),
      ...this.program.getSemanticDiagnostics(), // Get the diagnostics before emit to cache them in the buildInfo file.
    ];
  }

  emitResultFor(inputFile: MeteorCompiler.InputFile) {
    const sourceFile = this.program.getSourceFile(inputFile.getPathInPackage());
    this.program.emit(
      sourceFile,
      (fileName, data, writeByteOrderMark, onError, sourceFiles) => {
        console.log("Got emitted data");
      }
    );
  }

  processFilesForTarget(inputFiles: MeteorCompiler.InputFile[]) {
    console.log("processFilesForTarget called");
    this.startIncrementalCompilation();
    for (const inputFile of inputFiles) {
      this.emitResultFor(inputFile);
    }
  }
}

MeteorTypescriptCompiler = MeteorTypescriptCompilerImpl;
