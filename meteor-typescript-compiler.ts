import * as ts from "typescript";

export const syncAwaitPromise = <T>(p: Promise<T>): T => {
  const untypedPromise: any = p;
  if (!untypedPromise.await) {
    throw new Error("no-await");
  }
  const result: T = untypedPromise.await();
  return result;
};

interface EmitResult {
  fileName: string;
  data: string;
  writeByteOrderMark: boolean;
  sourceFiles: readonly ts.SourceFile[];
}

export class MeteorTypescriptCompilerImpl {
  private program: ts.EmitAndSemanticDiagnosticsBuilderProgram;
  private diagnostics: ts.Diagnostic[];

  startIncrementalCompilation() {
    const configPath = ts.findConfigFile(
      /*searchPath*/ "./",
      ts.sys.fileExists,
      "tsconfig.json"
    );
    if (!configPath) {
      throw new Error("Could not find a valid 'tsconfig.json'.");
    }

    console.log(`configPath: ${configPath}`);

    const buildInfoFile = ts.sys.resolvePath("./buildfile.tsbuildinfo");
    const config = ts.getParsedCommandLineOfConfigFile(
      configPath,
      /*optionsToExtend*/ {
        incremental: true,
        tsBuildInfoFile: buildInfoFile,
        noEmit: false,
        importHelpers: true,
        sourceMap: true,
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

    /** Save out buildinfo */
    this.program.emit(
      undefined,
      (fileName, data, writeByteOrderMark, onError, sourceFiles) => {
        if (fileName.includes("buildinfo")) {
          console.log(fileName);
        }
        if (fileName === buildInfoFile) {
          console.log(`Writing ${buildInfoFile}`);
          ts.sys.writeFile(fileName, data, writeByteOrderMark);
        }
      }
    );
  }

  emitAsync(sourceFile: ts.SourceFile): Promise<EmitResult> {
    return new Promise((resolve, reject) => {
      const result = this.program.emit(
        sourceFile,
        (fileName, data, writeByteOrderMark, onError, sourceFiles) => {
          resolve({ fileName, data, writeByteOrderMark, sourceFiles });
        }
      );
      if (result.emitSkipped || !result.emittedFiles) {
        reject(new Error(`nothing emitted for ${sourceFile.fileName}`));
      }
    });
  }

  emitResultFor(inputFile: MeteorCompiler.InputFile) {
    const inputFilePath = inputFile.getPathInPackage();
    const sourceFile =
      this.program.getSourceFile(inputFilePath) ||
      this.program.getSourceFile(ts.sys.resolvePath(inputFilePath));

    if (!sourceFile) {
      console.log(`${inputFilePath} - no source file found`);
      return;
    }
    try {
      const { data, fileName } = syncAwaitPromise(this.emitAsync(sourceFile));
      console.log(`emitting for ${inputFilePath}`);
      inputFile.addJavaScript({ data, path: fileName });
    } catch (e) {
      console.error(e.message);
    }
  }

  processFilesForTarget(inputFiles: MeteorCompiler.InputFile[]) {
    this.startIncrementalCompilation();

    const noDefinitionFiles = (f: MeteorCompiler.InputFile) =>
      !f.getBasename().match(/.d.ts$/);

    for (const inputFile of inputFiles.filter(noDefinitionFiles)) {
      this.emitResultFor(inputFile);
    }
  }
}

MeteorTypescriptCompiler = MeteorTypescriptCompilerImpl;
