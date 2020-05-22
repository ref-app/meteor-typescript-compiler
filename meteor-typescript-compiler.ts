import { bold, dim, reset } from "chalk";
import * as ts from "typescript";
import * as crypto from "crypto";

interface LocalEmitResult {
  fileName: string;
  data: string;
  writeByteOrderMark: boolean;
  sourceMap?: MeteorCompiler.SourceMap;
  sourceFiles: readonly ts.SourceFile[];
}

function isBare(inputFile: MeteorCompiler.InputFile): boolean {
  const fileOptions = inputFile.getFileOptions();
  return fileOptions && fileOptions.bare;
}

function calculateHash(source: string): string {
  return crypto.createHash("SHA1").update(source).digest("hex");
}

function getRelativeFileName(filename: string): string {
  const curDir = ts.sys.getCurrentDirectory();
  if (filename.startsWith(curDir)) {
    return filename.substring(curDir.length + 1);
  }
  return filename;
}

export class MeteorTypescriptCompilerImpl implements MeteorCompiler.Compiler {
  private program: ts.EmitAndSemanticDiagnosticsBuilderProgram;
  private diagnostics: ts.Diagnostic[];
  private traceEnabled = false;

  error(msg: string, ...other: string[]) {
    process.stderr.write(bold.red(msg) + reset(other.join(" ")) + "\n");
  }

  info(msg: string) {
    process.stdout.write(bold.green(msg) + dim(" ") + "\n");
  }

  trace(msg: string) {
    if (this.traceEnabled) {
      process.stdout.write(dim(msg) + dim(" ") + "\n");
    }
  }

  writeDiagnosticMessage(diagnostics: ts.Diagnostic, message: string) {
    switch (diagnostics.category) {
      case ts.DiagnosticCategory.Error:
        return this.error(message);
      case ts.DiagnosticCategory.Warning:
      case ts.DiagnosticCategory.Suggestion:
      case ts.DiagnosticCategory.Message:
        return this.info(message);
    }
  }

  writeDiagnostics(diagnostics: ts.Diagnostic[]) {
    diagnostics.forEach((diagnostic) => {
      if (diagnostic.file) {
        let { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
          diagnostic.start!
        );
        let message = ts.flattenDiagnosticMessageText(
          diagnostic.messageText,
          "\n"
        );
        this.writeDiagnosticMessage(
          diagnostic,
          `${getRelativeFileName(diagnostic.file.fileName)} (${line + 1},${
            character + 1
          }): ${message}`
        );
      } else {
        this.writeDiagnosticMessage(
          diagnostic,
          `${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`
        );
      }
    });
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
          this.error(ts.flattenDiagnosticMessageText(d.messageText, "\n")),
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

    /**
     * Save out buildinfo (there is not source file for buildinfo so we can’t look it up)
     * buildinfo is only written if it needs to be updated
     *
     * This method also gives us returns transpiled versions of all changed files so
     * we could use it smarter to only emit new js transpiled versions when we need to,
     * maybe by using the hash mechanism in the meteor build system ??
     */
    const emitResult = this.program.emit(
      undefined,
      (fileName, data, writeByteOrderMark, onError, sourceFiles) => {
        if (fileName === buildInfoFile) {
          this.info(`Writing ${getRelativeFileName(buildInfoFile)}`);
          ts.sys.writeFile(fileName, data, writeByteOrderMark);
        } else {
          if (sourceFiles.length > 0 && fileName.match(/\.js$/)) {
            // ignore .map files
            this.info(
              `Compiling ${getRelativeFileName(sourceFiles[0].fileName)}`
            );
          }
        }
      }
    );
    this.writeDiagnostics(this.diagnostics);
  }

  prepareSourceMap(
    sourceMapJson: string,
    inputFile: MeteorCompiler.InputFile,
    sourceFile: ts.SourceFile
  ): Object {
    const sourceMap: any = JSON.parse(sourceMapJson);
    sourceMap.sourcesContent = [sourceFile.text];
    sourceMap.sources = [inputFile.getPathInPackage()];
    return sourceMap;
  }

  emitForSource(
    inputFile: MeteorCompiler.InputFile,
    sourceFile: ts.SourceFile
  ): LocalEmitResult | undefined {
    let result: LocalEmitResult | undefined = undefined;
    let sourceMap: Object | string | undefined = undefined;
    this.trace(`Emitting Javascript for ${inputFile.getPathInPackage()}`);
    this.program.emit(
      sourceFile,
      (fileName, data, writeByteOrderMark, onError, sourceFiles) => {
        if (fileName.match(/\.map$/)) {
          sourceMap = this.prepareSourceMap(data, inputFile, sourceFile);
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
      // this.error(`Could not find source file for ${inputFilePath}`);
      return;
    }
    try {
      const emitResult = this.emitForSource(inputFile, sourceFile);
      if (!emitResult) {
        this.error(`Nothing emitted for ${inputFilePath}`);
        return;
      }
      const { data, fileName, sourceMap } = emitResult;
      // Write a relative path. Assume each ts(x) file compiles to a .js file
      const path = inputFilePath.replace(/\.tsx?$/, ".js");
      const bare = isBare(inputFile);
      const jsData: MeteorCompiler.AddJavaScriptOptions = {
        data,
        sourcePath: inputFilePath,
        path,
        sourceMap,
        bare,
      };
      inputFile.addJavaScript(jsData);
    } catch (e) {
      this.error(e.message);
    }
  }

  processFilesForTarget(inputFiles: MeteorCompiler.InputFile[]) {
    if (inputFiles.length > 0) {
      this.info(`Typescript compilation for ${inputFiles[0].getArch()}`);
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
