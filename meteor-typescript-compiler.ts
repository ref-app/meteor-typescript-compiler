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
  sourceMap?: string;
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

    //    console.log(`configPath: ${configPath}`);

    const buildInfoFile = ts.sys.resolvePath(
      ".meteor/local/buildfile.tsbuildinfo"
    );
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
        if (fileName === buildInfoFile) {
          console.log(`Writing ${buildInfoFile}`);
          ts.sys.writeFile(fileName, data, writeByteOrderMark);
        }
      }
    );
  }

  emitForSource(sourceFile: ts.SourceFile): EmitResult | undefined {
    let result: EmitResult | undefined = undefined;
    let sourceMap: string | undefined = undefined;

    const localResult = this.program.emit(
      sourceFile,
      (fileName, data, writeByteOrderMark, onError, sourceFiles) => {
        if (fileName.match(/\.map$/)) {
          sourceMap = data;
        } else {
          result = { data, fileName, writeByteOrderMark, sourceFiles };
        }
      }
    );
    if (!result) {
      return result;
    }
    return { ...result, sourceMap };
  }

  emitResultFor(inputFile: MeteorCompiler.InputFile) {
    const inputFilePath = inputFile.getPathInPackage();
    const sourceFile =
      this.program.getSourceFile(inputFilePath) ||
      this.program.getSourceFile(ts.sys.resolvePath(inputFilePath));

    if (!sourceFile) {
      return;
    }
    try {
      const emitResult = this.emitForSource(sourceFile);
      if (!emitResult) {
        console.error(`Nothing emitted for ${inputFilePath}`);
        return;
      }
      const { data, fileName, sourceMap } = emitResult;
      // console.log(
      //   `emitting ${fileName} ${
      //     sourceMap ? "with source map" : ""
      //   } for ${inputFilePath}`
      // );
      inputFile.addJavaScript({
        data,
        sourcePath: inputFilePath,
        path: fileName,
        sourceMap,
      });
    } catch (e) {
      console.error(e.message);
    }
  }

  processFilesForTarget(inputFiles: MeteorCompiler.InputFile[]) {
    if (inputFiles.length > 0) {
      console.info(`Typescript compilation for ${inputFiles[0].getArch()}`);
    }

    this.startIncrementalCompilation();

    const isCompilableFile = (f: MeteorCompiler.InputFile) => {
      const fileName = f.getBasename();
      return !fileName.match(/.d.ts$/) && !fileName.match(/^tsconfig.json$/i);
    };

    for (const inputFile of inputFiles.filter(isCompilableFile)) {
      this.emitResultFor(inputFile);
    }
  }
}

MeteorTypescriptCompiler = MeteorTypescriptCompilerImpl;
