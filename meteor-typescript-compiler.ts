import * as ts from "typescript";
import * as crypto from "crypto";
import { CompilerCache } from "compiler-cache";
import { setTraceEnabled, error, info, trace } from "compiler-console";

interface LocalEmitResult {
  fileName: string;
  data: string;
  sourceMap?: MeteorCompiler.SourceMap;
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

export class MeteorTypescriptCompilerImpl extends BabelCompiler {
  private program: ts.EmitAndSemanticDiagnosticsBuilderProgram;
  private diagnostics: ts.Diagnostic[];
  private numEmittedFiles = 0;
  private numStoredFiles = 0;
  private numCompiledFiles = 0;

  /**
   * Used to inject the source map into the babel compilation
   * through the inferExtraBabelOptions override
   */
  private withSourceMap:
    | { sourceMap: MeteorCompiler.SourceMap; pathInPackage: string }
    | undefined = undefined;

  private cache: CompilerCache | undefined = undefined;

  constructor() {
    super({});
    setTraceEnabled(!!process.env["TYPESCRIPT_TRACE_ENABLED"]);
  }

  writeDiagnosticMessage(diagnostics: ts.Diagnostic, message: string) {
    switch (diagnostics.category) {
      case ts.DiagnosticCategory.Error:
        return error(message);
      case ts.DiagnosticCategory.Warning:
      case ts.DiagnosticCategory.Suggestion:
      case ts.DiagnosticCategory.Message:
        return info(message);
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

  /**
   * TBD in order to not force all projects to repeat the Meteor filename inclusion rules in the tsconfig.json
   * exclude section, we should filter out files here:
   *    Files in directories named "tests"
   *    Files specified in .meteorignore files
   *    other Meteor rules
   *
   * An alternative would be to provide a custom version of getFilesInDir
   * to the host parameter of getParsedCommandLineOfConfigFile
   */
  filterSourceFilenames(sourceFiles: string[]): string[] {
    return sourceFiles;
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

    const cachePath = ".meteor/local/.typescript-incremental";
    const buildInfoFile = ts.sys.resolvePath(
      `${cachePath}/buildfile.tsbuildinfo`
    );
    if (!!process.env.TYPESCRIPT_CACHE) {
      this.cache = new CompilerCache(ts.sys.resolvePath(`{cachePath}/v1cache`));
    }
    const config = ts.getParsedCommandLineOfConfigFile(
      configPath,
      /*optionsToExtend*/ {
        incremental: true,
        tsBuildInfoFile: buildInfoFile,
        noEmit: false,
        sourceMap: true,
      },
      /*host*/ {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (d) =>
          error(ts.flattenDiagnosticMessageText(d.messageText, "\n")),
      }
    );
    if (!config) {
      throw new Error("Could not parse 'tsconfig.json'.");
    }

    config.fileNames = this.filterSourceFilenames(config.fileNames);

    // Too much information to handle for large projects…
    // trace("config.fileNames:\n" + config.fileNames.join("\n"));

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

    const writeIfBuildInfo = (
      fileName: string,
      data: string,
      writeByteOrderMark: boolean | undefined
    ): boolean => {
      if (fileName === buildInfoFile) {
        info(`Writing ${getRelativeFileName(buildInfoFile)}`);
        ts.sys.writeFile(fileName, data, writeByteOrderMark);
        return true;
      }
      return false;
    };
    /**
     * "emit" without a sourcefile will process all changed files, including the buildinfo file
     * so we need to write it out if it changed.
     * Then we can also tell which files were recompiled and put the data into the cache.
     */
    this.program.emit(
      undefined,
      (fileName, data, writeByteOrderMark, onError, sourceFiles) => {
        if (!writeIfBuildInfo(fileName, data, writeByteOrderMark)) {
          if (sourceFiles.length > 0) {
            const relativeSourceFilePath = getRelativeFileName(
              sourceFiles[0].fileName
            );
            if (fileName.match(/\.js$/)) {
              info(`Compiling ${relativeSourceFilePath}`);
              this.numCompiledFiles++;
              this.cache?.addJavascript(relativeSourceFilePath, {
                fileName,
                source: data,
              });
            }
            if (fileName.match(/\.map$/)) {
              this.cache?.addSourceMap(relativeSourceFilePath, data);
            }
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
    this.numEmittedFiles++;
    let result: LocalEmitResult | undefined = undefined;
    let sourceMapJson: string | undefined = undefined;
    trace(`Emitting Javascript for ${inputFile.getPathInPackage()}`);

    this.program.emit(sourceFile, (fileName, data) => {
      if (fileName.match(/\.map$/)) {
        sourceMapJson = data;
      } else {
        result = { data, fileName };
      }
    });
    if (!result) {
      return result;
    }
    const sourcePath = inputFile.getPathInPackage();
    this.cache?.addJavascript(sourcePath, {
      fileName: result.fileName,
      source: result.data,
    });
    const sourceMap = sourceMapJson
      ? this.prepareSourceMap(sourceMapJson, inputFile, sourceFile)
      : undefined;
    return { ...result, sourceMap };
  }

  getOutputForSource(
    inputFile: MeteorCompiler.InputFile,
    sourceFile: ts.SourceFile
  ): LocalEmitResult | undefined {
    const fromCache = this.cache?.get(inputFile.getPathInPackage());
    if (fromCache) {
      const {
        sourceMapJson,
        javascript: { fileName, source },
      } = fromCache;
      const sourceMap = this.prepareSourceMap(
        sourceMapJson,
        inputFile,
        sourceFile
      );
      return { data: source, sourceMap, fileName };
    }
    return this.emitForSource(inputFile, sourceFile);
  }

  public inferExtraBabelOptions(
    inputfile: MeteorCompiler.InputFile,
    babelOptions: any,
    cacheDeps: any
  ): boolean {
    if (
      this.withSourceMap &&
      inputfile.getPathInPackage() === this.withSourceMap.pathInPackage
    ) {
      // Ensure that the Babel compiler picks up our source maps
      babelOptions.inputSourceMap = this.withSourceMap.sourceMap;
    }
    return super.inferExtraBabelOptions(inputfile, babelOptions, cacheDeps);
  }

  emitResultFor(inputFile: MeteorCompiler.InputFile) {
    const inputFilePath = inputFile.getPathInPackage();
    const sourceFile =
      this.program.getSourceFile(inputFilePath) ||
      this.program.getSourceFile(ts.sys.resolvePath(inputFilePath));

    if (!sourceFile) {
      trace(`Could not find source file for ${inputFilePath}`);
      return;
    }
    try {
      const sourcePath = inputFile.getPathInPackage();
      const bare = isBare(inputFile);
      const hash = inputFile.getSourceHash();
      inputFile.addJavaScript({ path: sourcePath, bare, hash }, () => {
        this.numStoredFiles++;
        const emitResult = this.getOutputForSource(inputFile, sourceFile);
        if (!emitResult) {
          error(`Nothing emitted for ${inputFilePath}`);
          return;
        }
        const { data, fileName, sourceMap } = emitResult;
        // To get Babel processing, we must invoke it ourselves via the
        // inherited BabelCompiler method processOneFileForTarget
        // To get the source map injected we override inferExtraBabelOptions
        this.withSourceMap = {
          sourceMap,
          pathInPackage: inputFilePath,
        };
        const jsData = this.processOneFileForTarget(inputFile, data);
        // Use the same hash as in the deferred data
        return {
          ...jsData,
          hash,
        };
      });
    } catch (e) {
      error(e.message);
    }
  }

  // Called by the compiler plugins system after all linking and lazy
  // compilation has finished. (bundler.js)
  afterLink() {
    if (this.numStoredFiles || this.numEmittedFiles) {
      info(
        `Typescript: ${this.numEmittedFiles} files emitted, ${this.numStoredFiles} transpiled files sent on for bundling`
      );
    }
    // Reset since this method gets called once for each resourceSlot
    this.numEmittedFiles = 0;
    this.numStoredFiles = 0;
  }

  processFilesForTarget(inputFiles: MeteorCompiler.InputFile[]) {
    if (inputFiles.length === 0) {
      return;
    }

    this.numEmittedFiles = 0;
    this.numStoredFiles = 0;
    this.numCompiledFiles = 0;

    const firstInput = inputFiles[0];
    const startTime = Date.now();
    info(
      `Typescript compilation for ${firstInput.getArch()} using Typescript ${
        ts.version
      }`
    );

    this.startIncrementalCompilation();

    const isCompilableFile = (f: MeteorCompiler.InputFile) => {
      const fileName = f.getBasename();
      const dirName = f.getDirname();
      return (
        !fileName.endsWith(".d.ts") &&
        fileName !== "tsconfig.json" &&
        // we really don’t want to compile .ts files in node_modules but meteor will send them
        // anyway as input files. Adding node_modules to .meteorignore causes other runtime problems
        // so this is a somewhat ugly workaround
        !dirName.startsWith("node_modules/")
      );
    };
    const compilableFiles = inputFiles.filter(isCompilableFile);
    for (const inputFile of compilableFiles) {
      this.emitResultFor(inputFile);
    }
    const endTime = Date.now();
    const delta = endTime - startTime;
    info(
      `Compilation finished in ${Math.round(delta / 100) / 10} seconds. ${
        compilableFiles.length
      } input files, ${this.numCompiledFiles} files compiled`
    );
  }
}

MeteorTypescriptCompiler = MeteorTypescriptCompilerImpl;
