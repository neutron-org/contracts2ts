#!/usr/bin/env node

import codegen from '@cosmwasm/ts-codegen';
import { cliArguments } from 'cli-argument-parser';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import getFiles from 'node-recursive-directory';
import path from 'path';

(async () => {
  const contractPath = cliArguments.src;
  if (Object.keys(cliArguments).length !== 3) {
    console.log(
      'Usage: contracts2ts --src <path to contracts> --out <path to output> --scope <scope>',
    );
    process.exit(0);
  }
  if (!contractPath) {
    throw new Error('Contract path is not defined');
  }
  const outputDir = cliArguments.out;
  if (!outputDir) {
    throw new Error('Output path is not defined');
  }
  const scope = cliArguments.scope;
  if (!scope) {
    throw new Error('Scope is not defined');
  }
  const buildSchema = cliArguments.buildSchema === 'false' ? false : true;
  const dir = path.join(process.cwd(), contractPath, '/contracts');
  const files = (await getFiles(dir)).filter((file) =>
    file.endsWith('Cargo.toml'),
  );
  const contracts: { dir: string; name: string }[] = files.map((file) => ({
    dir: path.dirname(file),
    name: path.basename(path.dirname(file)),
  }));
  if (buildSchema) {
    for (const contract of contracts) {
      await new Promise((r, rj) =>
        exec('cargo schema', { cwd: contract.dir }, (err, stdout, stderr) => {
          if (err) {
            console.error(err);
            rj(err);
          } else {
            console.log(stdout);
            console.error(stderr);
            r(true);
          }
        }),
      );
    }
  }
  const contractsForCodegen = await Promise.all(
    contracts.map(async (contract) => {
      //check if schema exists
      const schemaPath = path.join(contract.dir, '/schema/raw');
      const schemaExists = await fs
        .access(schemaPath)
        .then(() => true)
        .catch(() => false);
      return {
        name: contract.name,
        dir: schemaExists ? schemaPath : path.join(contract.dir, '/schema'),
      };
    }),
  );

  await codegen({
    contracts: contractsForCodegen,
    outPath: path.join(process.cwd(), outputDir),
    options: {
      bundle: {
        bundleFile: 'index.ts',
        scope,
      },
      types: {
        enabled: true,
      },
      client: {
        enabled: true,
      },
      messageComposer: {
        enabled: false,
      },
    },
  });
  console.log('Done');
})();
