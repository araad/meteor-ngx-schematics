import { parseJson, strings } from '@angular-devkit/core';
import {
  apply,
  branchAndMerge,
  chain,
  externalSchematic,
  mergeWith,
  noop,
  Rule,
  SchematicContext,
  SchematicsException,
  template,
  Tree,
  url
} from '@angular-devkit/schematics';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';
import {
  addProjectToWorkspace,
  getWorkspace
} from '@schematics/angular/utility/config';
import {
  addPackageJsonDependency,
  NodeDependencyType
} from '@schematics/angular/utility/dependencies';
import { latestVersions } from '@schematics/angular/utility/latest-versions';
import { validateProjectName } from '@schematics/angular/utility/validation';
import {
  Builders,
  ProjectType,
  WorkspaceSchema
} from '@schematics/angular/utility/workspace-models';

function updateJsonFile(host: Tree, path: string, callback: Function) {
  const source = host.read(path);
  if (source) {
    const sourceText = source.toString('utf-8');
    const json = parseJson(sourceText);
    callback(json);
    host.overwrite(path, JSON.stringify(json, null, 2));
  }
  return host;
}

function updateTsConfig(packageName: string, distRoot: string) {
  return (host: Tree) => {
    if (!host.exists('tsconfig.json')) {
      return host;
    }
    return updateJsonFile(host, 'tsconfig.json', (tsconfig: any) => {
      if (!tsconfig.compilerOptions.paths) {
        tsconfig.compilerOptions.paths = {};
      }
      if (!tsconfig.compilerOptions.paths[packageName]) {
        tsconfig.compilerOptions.paths[packageName] = [];
      }
      tsconfig.compilerOptions.paths[packageName].push(distRoot);
      // deep import & secondary entrypoint support
      const deepPackagePath = packageName + '/*';
      if (!tsconfig.compilerOptions.paths[deepPackagePath]) {
        tsconfig.compilerOptions.paths[deepPackagePath] = [];
      }
      tsconfig.compilerOptions.paths[deepPackagePath].push(distRoot + '/*');
    });
  };
}

function addDependenciesToPackageJson() {
  return (host: Tree) => {
    [
      {
        type: NodeDependencyType.Dev,
        name: '@angular/compiler-cli',
        version: latestVersions.Angular
      },
      {
        type: NodeDependencyType.Dev,
        name: '@angular-devkit/build-ng-packagr',
        version: latestVersions.DevkitBuildNgPackagr
      },
      {
        type: NodeDependencyType.Dev,
        name: '@angular-devkit/build-angular',
        version: latestVersions.DevkitBuildNgPackagr
      },
      {
        type: NodeDependencyType.Dev,
        name: 'ng-packagr',
        version: '^4.2.0'
      },
      {
        type: NodeDependencyType.Dev,
        name: 'tsickle',
        version: '>=0.29.0'
      },
      {
        type: NodeDependencyType.Dev,
        name: 'tslib',
        version: latestVersions.TsLib
      },
      {
        type: NodeDependencyType.Dev,
        name: 'typescript',
        version: latestVersions.TypeScript
      }
    ].forEach(dependency => addPackageJsonDependency(host, dependency));
    return host;
  };
}

function addApptoWorkspaceFile(
  options: any,
  workspace: WorkspaceSchema,
  projectRoot: string,
  projectName: string
): Rule {
  const project: any = {
    root: projectRoot,
    sourceRoot: `${projectRoot}/client/src`,
    projectType: ProjectType.Library,
    prefix: options.prefix || 'lib',
    architect: {
      build: {
        builder: Builders.NgPackagr,
        options: {
          tsConfig: `${projectRoot}/tsconfig.lib.json`,
          project: `${projectRoot}/ng-package.json`
        }
      },
      test: {
        builder: Builders.Karma,
        options: {
          main: `${projectRoot}/src/test.ts`,
          tsConfig: `${projectRoot}/tsconfig.spec.json`,
          karmaConfig: `${projectRoot}/karma.conf.js`
        }
      },
      lint: {
        builder: Builders.TsLint,
        options: {
          tsConfig: [
            `${projectRoot}/tsconfig.lib.json`,
            `${projectRoot}/tsconfig.spec.json`
          ],
          exclude: ['**/node_modules/**']
        }
      }
    }
  };
  return addProjectToWorkspace(workspace, projectName, project);
}

export default function(options: any): Rule {
  return (host: Tree, _context: SchematicContext) => {
    if (!options.name) {
      throw new SchematicsException(`Invalid options, "name" is required.`);
    }

    const prefix = options.prefix || 'lib';
    validateProjectName(options.name);

    // If scoped project (i.e. "@foo/bar"), convert projectDir to "foo/bar".
    const projectName = options.name;
    const packageName = strings.dasherize(projectName);
    let scopeName = null;

    if (/^@.*\/.*/.test(options.name)) {
      const [scope, name] = options.name.split('/');
      scopeName = scope.replace(/^@/, '');
      options.name = name;
    }

    const workspace = getWorkspace(host);
    const newProjectRoot = workspace.newProjectRoot;
    const scopeFolder = scopeName ? strings.dasherize(scopeName) + '-' : '';
    const folderName = `${scopeFolder}${strings.dasherize(options.name)}`;
    const projectRoot = `${newProjectRoot}/${folderName}`;
    const distRoot = `dist/${folderName}`;
    const sourceDir = `${projectRoot}/client/src/lib`;
    const meteorPackageScope = scopeName
      ? strings.dasherize(scopeName) + ':'
      : '';
    const meteorPackageName =
      meteorPackageScope + strings.dasherize(options.name);
    const relativePathToWorkspaceRoot = projectRoot
      .split('/')
      .map(() => '..')
      .join('/');

    const templateSource = apply(url('./files'), [
      template(
        Object.assign({}, strings, options, {
          packageName,
          projectRoot,
          distRoot,
          folderName,
          relativePathToWorkspaceRoot,
          prefix,
          meteorPackageName,
          angularLatestVersion: latestVersions.Angular.replace('~', '').replace(
            '^',
            ''
          )
        })
      )
    ]);

    return chain([
      branchAndMerge(mergeWith(templateSource)),
      addApptoWorkspaceFile(options, workspace, projectRoot, projectName),
      options.skipPackageJson ? noop() : addDependenciesToPackageJson(),
      options.skipTsConfig ? noop() : updateTsConfig(packageName, distRoot),
      externalSchematic('@schematics/angular', 'module', {
        name: options.name,
        commonModule: false,
        flat: true,
        path: sourceDir,
        project: options.name
      }),
      (_tree, context) => {
        if (!options.skipPackageJson && !options.skipInstall) {
          context.addTask(new NodePackageInstallTask());
        }
      }
    ]);
  };
}
