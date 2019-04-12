/*
* server.ts
*
* Implements pyright language server.
*/

import {
    createConnection, IConnection,
    InitializeResult, IPCMessageReader, IPCMessageWriter, Location,
    Position, Range, TextDocuments
} from 'vscode-languageserver';

import { exec, ExecException } from 'child_process';
import { getDirectoryPath } from './common/pathUtils';

// interface Settings {
//     python: PythonSettings;
// }

// Stash the base directory into a global variable.
(global as any).__rootDirectory = getDirectoryPath(__dirname);

// Create a connection for the server. The connection uses Node's IPC as a transport
let _connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

_connection.console.log('Pyright language server starting');

// Create a simple text document manager. The text document manager
// supports full document sync only.
let _documents: TextDocuments = new TextDocuments();

// Tracks whether we're currently displaying progress.
// let _isDisplayingProgress = false;

// Make the text document manager listen on the connection
// for open, change and close text document events.
_documents.listen(_connection);

const dmypy = '/Users/matan/Documents/code/mypy/.venv38/bin/dmypy';

let started = false;
let queuedAnalyses: string[] = [];

let _rootPath: string | null;

// After the server has started the client sends an initialize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilities.
_connection.onInitialize((params): InitializeResult => {

    // Don't allow the analysis engine to go too long without
    // reporting results. This will keep it responsive.
    // _analyzerService.setMaxAnalysisDuration({
    //     openFilesTimeInMs: 50,
    //     noOpenFilesTimeInMs: 1000
    // });

    // _analyzerService.setCompletionCallback(results => {
    //     results.diagnostics.forEach(fileDiag => {
    //         let diagnostics = _convertDiagnostics(fileDiag.diagnostics);

    //         // Send the computed diagnostics to the client.
    //         _connection.sendDiagnostics({
    //             uri: _convertPathToUri(fileDiag.filePath),
    //             diagnostics
    //         });

    //         if (results.filesRequiringAnalysis > 0) {
    //             if (!_isDisplayingProgress) {
    //                 _isDisplayingProgress = true;
    //                 _connection.sendNotification('pyright/beginProgress');
    //             }

    //             const fileOrFiles = results.filesRequiringAnalysis !== 1 ? 'files' : 'file';
    //             _connection.sendNotification('pyright/reportProgress',
    //                 `${ results.filesRequiringAnalysis } ${ fileOrFiles } to analyze`);
    //         } else {
    //             if (_isDisplayingProgress) {
    //                 _isDisplayingProgress = false;
    //                 _connection.sendNotification('pyright/endProgress');
    //             }
    //         }
    //     });
    // });
    if (params.rootUri === null) {
        _connection.console.log(`No root URI, quitting.`);
        return {capabilities: {}};
    }

    _rootPath = _convertUriToPath(params.rootUri);
    _connection.console.log(`Running dmypy in ${process.cwd()}`);
    // execLog(`${dmypy} restart --log-file dmypy.log -- --use-fine-grained-cache --follow-imports=skip`, (error, stdout, stderr) => {
    //     started = true;
    //     // for (const queued of queuedAnalyses) {
    //     //     analyze(queued);
    //     // }
    //     // queuedAnalyses = [];
    //     analyzeWorkspaceFolder();
    // });
    execLog(`${dmypy} run --log-file dmypy.log -- ${_rootPath} --follow-imports=skip`, (error, stdout, stderr) => {
        started = true;
        _connection.console.log(`dmypy run finished`);
    });
    return {
        capabilities: {
            // Tell the client that the server works in FULL text document
            // sync mode (as opposed to incremental).
            textDocumentSync: _documents.syncKind,
            definitionProvider: true
            // hoverProvider: true
        }
    };
});

function analyzeWorkspaceFolder() {
    if (!started || _rootPath === null) {
        return;
    }
    // analyze(_rootPath);
    recheck();
}

_connection.onExit(() => {
    started = false;
    execLog(`${dmypy} stop`);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
_documents.onDidSave(change => {
    // TODO: not actually called
    let filePath = _convertUriToPath(change.document.uri);
    _connection.console.log(`File "${ filePath }" saved -- checking`);
    queueAnalyze(filePath);
    // _analyzerService.markFilesChanged([filePath]);
    // updateOptionsAndRestartService();
});
// _connection.onDidChangeConfiguration(change => {
    // _connection.console.log(`Received updated settings.`);
    // updateOptionsAndRestartService(change.settings);
// });

_connection.onDidSaveTextDocument(change => {
    let filePath = _convertUriToPath(change.textDocument.uri);
    _connection.console.log(`File "${ filePath }" saved [conn] -- checking`);
    analyzeWorkspaceFolder();
});

_connection.onDefinition(async params => {
    let filePath = _convertUriToPath(params.textDocument.uri);
    const stdout = await new Promise<string>(resolve => {
        execLog(`${dmypy} suggest --callsites "${filePath} ${params.position.line + 1} ${params.position.character + 1}"`,
            (_error, stdout, _stderr) => {
            resolve(stdout);
        });
    });
    // let position: DiagnosticTextPosition = {
    //     line: params.position.line,
    //     column: params.position.character
    // };

    // let location = _analyzerService.getDefinitionForPosition(filePath, position);
    // if (!location) {
    //     return undefined;
    // }
    // return Location.create(_convertPathToUri(location.path), _convertRange(location.range));
    const result = /at (.+):([0-9]+):([0-9]+)/.exec(stdout);
    if (!result) {
        return null;
    }
    _connection.console.log(`Found definition at ${result[1]}:${result[2]}:${result[3]}`);
    const position = Position.create(parseInt(result[2], 10) - 1, parseInt(result[3], 10) - 1);
    return Location.create(_convertPathToUri(result[1]), Range.create(position, position));
});

function queueAnalyze(filePath: string) {
    if (started) {
        analyze(filePath);
    } else {
        queuedAnalyses.push(filePath);
    }
}

function analyze(filePath: string) {
    _connection.console.log(`Analyzing "${ filePath }"`);
    execLog(`${dmypy} check -- ${filePath}`);
}

function recheck() {
    _connection.console.log('Rechecking');
    execLog(`${dmypy} recheck`);
}

// _connection.onHover(params => {
//     let filePath = _convertUriToPath(params.textDocument.uri);

//     let position: DiagnosticTextPosition = {
//         line: params.position.line,
//         column: params.position.character
//     };

//     let hoverMarkdown = _analyzerService.getHoverForPosition(filePath, position);
//     if (!hoverMarkdown) {
//         return undefined;
//     }
//     let markupContent: MarkupContent = {
//         kind: 'markdown',
//         value: hoverMarkdown
//     };
//     return { contents: markupContent };
// });

// function updateOptionsAndRestartService(settings?: Settings) {
//     let commandLineOptions = new CommandLineOptions(_rootPath, true);
//     commandLineOptions.watch = true;
//     if (settings && settings.python) {
//         if (settings.python.venvPath) {
//             commandLineOptions.venvPath = combinePaths(_rootPath,
//                 normalizePath(_expandPathVariables(settings.python.venvPath)));
//         }
//         if (settings.python.analysis &&
//                 settings.python.analysis.typeshedPaths &&
//                 settings.python.analysis.typeshedPaths.length > 0) {

//             // Pyright supports only one typeshed path currently, whereas the
//             // official VS Code Python extension supports multiple typeshed paths.
//             // We'll use the first one specified and ignore the rest.
//             commandLineOptions.typeshedPath =
//                 _expandPathVariables(settings.python.analysis.typeshedPaths[0]);
//         }
//     }

//     _analyzerService.setOptions(commandLineOptions);
// }

// Expands certain predefined variables supported within VS Code settings.
// Ideally, VS Code would provide an API for doing this expansion, but
// it doesn't. We'll handle the most common variables here as a convenience.
// function _expandPathVariables(value: string): string {
//     const regexp = /\$\{(.*?)\}/g;
//     return value.replace(regexp, (match: string, name: string) => {
//         const trimmedName = name.trim();
//         if (trimmedName === 'workspaceFolder') {
//             return _rootPath;
//         }
//         return match;
//     });
// }

// function _convertDiagnostics(diags: AnalyzerDiagnostic[]): Diagnostic[] {
//     return diags.map(diag => {
//         let severity = diag.category === DiagnosticCategory.Error ?
//             DiagnosticSeverity.Error : DiagnosticSeverity.Warning;

//         return Diagnostic.create(_convertRange(diag.range), diag.message, severity,
//             undefined, 'pyright');
//     });
// }

// function _convertRange(range?: DiagnosticTextRange): Range {
//     if (!range) {
//         return Range.create(_convertPosition(), _convertPosition());
//     }
//     return Range.create(_convertPosition(range.start), _convertPosition(range.end));
// }

// function _convertPosition(position?: DiagnosticTextPosition): Position {
//     if (!position) {
//         return Position.create(0, 0);
//     }
//     return Position.create(position.line, position.column);
// }

// _connection.onDidOpenTextDocument(params => {
//     const filePath = _convertUriToPath(params.textDocument.uri);
//     _connection.console.log(`File "${filePath}" opened -- not checking`);
//     // queueAnalyze(filePath);
//     // TODO: what to do with opened files outside workspace?
// });

// _connection.onDidChangeTextDocument(params => {
//     let filePath = _convertUriToPath(params.textDocument.uri);
//     _analyzerService.updateOpenFileContents(
//         filePath,
//         params.textDocument.version,
//         params.contentChanges[0].text);
// });

// _connection.onDidCloseTextDocument(params => {
//     let filePath = _convertUriToPath(params.textDocument.uri);
//     _analyzerService.setFileClosed(filePath);
// });

function _convertUriToPath(uri: string): string {
    const fileScheme = 'file://';
    if (uri.startsWith(fileScheme)) {
        return uri.substr(fileScheme.length);
    }

    return uri;
}

function _convertPathToUri(path: string): string {
    return 'file://' + path;
}

// Listen on the connection
_connection.listen();

async function execAsync(command: string): Promise<string> {
    return new Promise<string>(resolve => {
        _connection.console.log(`Execute: ${command}`);
        exec(command, (error, stdout, stderr) => {
            _connection.console.log(`command finished, result: ${error ? `failed (${error.code})` : 'success'}`);
            if (stdout) {
                _connection.console.log(`stdout:\n${stdout}`);
            }
            if (stderr) {
                _connection.console.log(`stderr:\n${stderr}`);
            }
            resolve(stdout);
        });
    });
}

function execLog(command: string, callback?: (error: ExecException | null, stdout: string, stderr: string) => void) {
    _connection.console.log(`Execute: ${command}`);
    _connection.console.log(`cwd: ${process.cwd()}`);
    exec(command, (error, stdout, stderr) => {
        _connection.console.log(`command finished, result: ${error ? `failed (${error.code})` : 'success'}`);
        if (stdout) {
            _connection.console.log(`stdout:\n${stdout}`);
        }
        if (stderr) {
            _connection.console.log(`stderr:\n${stderr}`);
        }

        if (callback) {
            callback(error, stdout, stderr);
        }
    });
}
