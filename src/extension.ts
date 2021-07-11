import * as path from "path";
import { URL } from "url";
import * as vscode from "vscode";
import { API, GitExtension, Repository, RepositoryState } from "./typing/git";
import { GetPermalinkError, failIfUndefined, failIfNull } from "./util";

interface RepositoryName {
  organization: string;
  repository: string;
}

interface RepositoryInfo extends RepositoryName {
  rootUri: vscode.Uri;
  state: RepositoryState;
}

interface SelectionInfo {
  fileUri: vscode.Uri;
  startLine: number;
  endLine: number;
  isSingleLine: boolean;
}

const GITHUB_REMOTE_SSH_REGEX: RegExp = new RegExp(
  "^(?:ssh://)?git@github.com:(?<organization>[^/]+)/(?<repository>.+?)(?:.git)?$"
);
const GITHUB_REMOTE_HTTP_REGEX: RegExp = new RegExp(
  "^https?://github.com/(?<organization>[^/]+)/(?<repository>.+?)(?:.git)?$"
);

function getGitOrElse(): API {
  const gitExtension = failIfUndefined<GitExtension>(
    vscode.extensions.getExtension<GitExtension>("vscode.git")?.exports,
    "VSCode Git extension must be configured"
  );
  return gitExtension.getAPI(1);
}

function getSelectionInfo(activeTextEditor: vscode.TextEditor): SelectionInfo {
  const fileUri: vscode.Uri = vscode.Uri.parse(
    activeTextEditor.document.fileName
  );
  const { start, end, isSingleLine } = activeTextEditor.selection;
  return { fileUri, startLine: start.line, endLine: end.line, isSingleLine };
}

function parseGithubUrl(url: string | undefined): RepositoryName | undefined {
  if (url === undefined) {
    return;
  }

  // Try to match this URL as an SSH URL, and then as an HTTP one:
  const match =
    url.match(GITHUB_REMOTE_SSH_REGEX) ?? url.match(GITHUB_REMOTE_HTTP_REGEX);
  if (match === null || match.groups === undefined) {
    return;
  }
  const { organization, repository } = match.groups;
  return { organization, repository };
}

function getRepositoryInfo(git: API, fileUri: vscode.Uri): RepositoryInfo {
  const repository = failIfNull<Repository>(
    git.getRepository(fileUri),
    `No matching repository found for file ${fileUri.toString()}`
  );
  for (let remote of repository.state.remotes) {
    const repositoryName = parseGithubUrl(remote.fetchUrl ?? remote.pushUrl);
    if (repositoryName !== undefined) {
      return {
        ...repositoryName,
        state: repository.state,
        rootUri: repository.rootUri,
      };
    }
  }
  throw new GetPermalinkError(
    "No GitHub origins found for matching repository"
  );
}

function getLineAnchor(selection: SelectionInfo): string {
  // use startLine + 1 and endLine + 1 because GitHub line numbers are 1-indexed
  return selection.isSingleLine
    ? `L${selection.startLine + 1}`
    : `L${selection.startLine + 1}-L${selection.endLine + 1}`;
}

function getCommitHash(repositoryState: RepositoryState): string {
  return failIfUndefined<string>(
    repositoryState.HEAD?.commit,
    "Couldn't determine commit sha for HEAD"
  );
}

function failIfChangedFile(
  repositoryState: RepositoryState,
  fileUri: vscode.Uri
) {
  repositoryState.workingTreeChanges.forEach((change) => {
    if (change.uri.path === fileUri.path) {
      throw new GetPermalinkError(
        `Can't copy permalink because file ${fileUri.path} has been modified`
      );
    }
  });
}

function getLinkForSelection(git: API, selection: SelectionInfo): URL {
  const repositoryInfo = getRepositoryInfo(git, selection.fileUri);
  failIfChangedFile(repositoryInfo.state, selection.fileUri);

  const relativePath = path.relative(
    repositoryInfo.rootUri.fsPath,
    selection.fileUri.fsPath
  );

  const commitHash = getCommitHash(repositoryInfo.state);
  const tokenizedRelativePath: Array<string> = relativePath.split(path.sep);
  const uriPathTokens = [
    repositoryInfo.organization,
    repositoryInfo.repository,
    "blob",
    commitHash,
    ...tokenizedRelativePath,
  ];
  const url = new URL("https://github.com");
  url.pathname = `/${uriPathTokens.join("/")}`;
  url.hash = getLineAnchor(selection);
  return url;
}

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    "get-github-permalink.getPermalink",
    () => {
      try {
        const git = getGitOrElse();
        const activeTextEditor = failIfUndefined<vscode.TextEditor>(
          vscode.window.activeTextEditor,
          "Could not find active text editor"
        );
        const selectionInfo = getSelectionInfo(activeTextEditor);
        const link = getLinkForSelection(git, selectionInfo);

        vscode.env.clipboard.writeText(link.toString()).then(
          (_success) => {
            vscode.window.showInformationMessage(
              "Copied GitHub link to clipboard"
            );
          },
          (failed) => {
            vscode.window.showErrorMessage(`Failed copying: ${failed}`);
          }
        );
      } catch (err) {
        if (err instanceof GetPermalinkError) {
          vscode.window.showErrorMessage(err.message);
        } else {
          throw err;
        }
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
