import { compile } from 'json-schema-to-typescript';
import { JSONSchema4 } from 'json-schema';
import { promises as fs } from 'fs';
import _ from 'lodash';
import path from 'path';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import debug from 'debug';

const log = debug('schemaToTs');
type KVJsonSchema = { [k: string]: JSONSchema4 };

const fixEnum = (o: JSONSchema4) => {
  if (o.type === 'string' && o.enum && o.enum.length === 0) {
    o.type = 'object';
    delete o.enum;
  }
  return o;
};

const fixEmptyEnums = (o: KVJsonSchema) => {
  for (const [, dVal] of Object.entries(o)) {
    fixEnum(dVal);
  }
  return o;
};

export const schemaToTs = async (
  filePath: string,
  scope: string,
  outDir: string,
) => {
  log('schemaToTs', filePath, scope, outDir);
  const file = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  let importOut = `import { CosmWasmClient, SigningCosmWasmClient, ExecuteResult, InstantiateResult } from "@cosmjs/cosmwasm-stargate"; 
import { StdFee } from "@cosmjs/amino";
`;
  let out = ``;
  let typesOut = '';
  const queryMap = {};
  let hasCoin = false;

  let definitions = {};
  const globalSchema: JSONSchema4 = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: `${scope}Schema`,
    type: 'object',
    required: [],
    properties: {},
  };
  if (file.responses && Object.keys(file.responses).length) {
    (globalSchema.required as string[]).push('responses');
    globalSchema.properties.responses = {
      type: 'object',
      oneOf: [],
    };
    for (const [fnName, value] of Object.entries(file.responses)) {
      const title = (value as any).title;
      const newTitle = _.upperFirst(
        title
          .replace(/Array_of_/, 'ArrayOf')
          .replace(/Tuple_of/, 'TupleOf')
          .replace(/_and_/, 'And_'),
      );
      log((value as any).title);
      fixEnum(value);
      if ((value as any).title === 'Coin') {
        hasCoin = true;
      }
      if ((value as any).definitions) {
        definitions = { ...definitions, ...(value as any).definitions };
      }
      (value as any).title = newTitle;
      globalSchema.properties.responses.oneOf.push(value);
      queryMap[fnName] = newTitle;
    }
  }

  out += `

function isSigningCosmWasmClient(
  client: CosmWasmClient | SigningCosmWasmClient
): client is SigningCosmWasmClient {
  return 'execute' in client;
}

export class Client {
  private readonly client: CosmWasmClient | SigningCosmWasmClient;
  contractAddress: string;
  constructor(client: CosmWasmClient | SigningCosmWasmClient, contractAddress: string) {
    this.client = client;
    this.contractAddress = contractAddress;
  }
  mustBeSigningClient() {
    return new Error("This client is not a SigningCosmWasmClient");
  }
  static async instantiate(
    client: SigningCosmWasmClient,
    sender: string,
    codeId: number,
    initMsg: InstantiateMsg,
    label: string,
    fees: StdFee | 'auto' | number,
    initCoins?: readonly Coin[],
  ): Promise<InstantiateResult> {
    const res = await client.instantiate(sender, codeId, initMsg, label, fees, {
      ...(initCoins && initCoins.length && { funds: initCoins }),
    });
    return res;
  }
  static async instantiate2(
    client: SigningCosmWasmClient,
    sender: string,
    codeId: number,
    salt: number,
    initMsg: InstantiateMsg,
    label: string,
    fees: StdFee | 'auto' | number,
    initCoins?: readonly Coin[],
  ): Promise<InstantiateResult> {
    const res = await client.instantiate2(sender, codeId, new Uint8Array([salt]), initMsg, label, fees, {
      ...(initCoins && initCoins.length && { funds: initCoins }),
    });
    return res;
  }
`;

  if (file.query && file.query.oneOf) {
    globalSchema.properties.query = {
      type: 'object',
      oneOf: [],
    };
    definitions = { ...definitions, ...(file.query as any).definitions };
    let wasRequired = false;
    for (const query of file.query.oneOf) {
      const queryName = query.required ? query.required[0] : query.enum[0];
      const outType = queryMap[queryName]
        .replace('_for_', 'For_')
        .replace('_of_', 'Of_')
        .replace('_and_', 'And_');
      const inType = query.properties && query.properties[queryName];
      log('generating query', queryName);
      if (inType && inType.properties) {
        wasRequired = true;
        const compType = {
          ...inType,
          title: `${queryName}Args`,
        };
        globalSchema.properties.query.oneOf.push(compType);
        out += `  query${_.upperFirst(
          _.camelCase(queryName),
        )} = async(args: ${_.upperFirst(
          _.camelCase(queryName),
        )}Args): Promise<${outType}> => {
    return this.client.queryContractSmart(this.contractAddress, { ${queryName}: args });
  }
`;
      } else {
        out += `  query${_.upperFirst(
          _.camelCase(queryName),
        )} = async(): Promise<${outType}> => {
    return this.client.queryContractSmart(this.contractAddress, { ${queryName}: {} });
  }
`;
      }
    }
    if (!wasRequired) {
      delete globalSchema.properties.query;
    } else {
      (globalSchema.required as string[]).push('query');
    }
  }
  log('query compiled');

  if (file.execute && file.execute.oneOf) {
    log('adding execute');
    definitions = { ...definitions, ...(file.execute as any).definitions };
    globalSchema.properties.execute = {
      type: 'object',
      oneOf: [],
    };
    let wasRequired = false;
    for (const execute of file.execute.oneOf) {
      const executeName = execute.required[0];
      const inType = execute.properties[executeName];
      log('generating execute', executeName, inType);
      if (inType['$ref']) {
        inType.properties =
          file.execute.definitions[inType['$ref'].split('/')[2]];
      }
      if (inType.properties) {
        wasRequired = true;
        const compType = {
          ...inType,
          title: `${executeName}Args`,
        };
        globalSchema.properties.execute.oneOf.push(compType);
        out += `  ${_.camelCase(
          executeName,
        )} = async(sender:string, args: ${_.upperFirst(
          _.camelCase(executeName),
        )}Args, fee?: number | StdFee | "auto", memo?: string, funds?: Coin[]): Promise<ExecuteResult> =>  {
          if (!isSigningCosmWasmClient(this.client)) { throw this.mustBeSigningClient(); }
    return this.client.execute(sender, this.contractAddress, { ${executeName}: args }, fee || "auto", memo, funds);
  }
`;
      } else {
        out += `  ${_.camelCase(
          executeName,
        )} = async(sender: string, fee?: number | StdFee | "auto", memo?: string, funds?: Coin[]): Promise<ExecuteResult> =>  {
          if (!isSigningCosmWasmClient(this.client)) { throw this.mustBeSigningClient(); }
    return this.client.execute(sender, this.contractAddress, { ${executeName}: {} }, fee || "auto", memo, funds);
  }
`;
      }
    }
    if (!wasRequired) {
      delete globalSchema.properties.execute;
    } else {
      (globalSchema.required as string[]).push('execute');
    }
  }
  log('execute compiled');
  if (file.instantiate) {
    globalSchema.properties.instantiate = file.instantiate;
    definitions = { ...definitions, ...file.instantiate.definitions };
  }

  out += `}
`;
  globalSchema.definitions = fixEmptyEnums(definitions);
  if (!hasCoin && !globalSchema.definitions.Coin) {
    importOut += `import { Coin } from "@cosmjs/amino";
`;
  }
  const x = globalSchema;

  typesOut += await compile(
    (await $RefParser.dereference(x)) as JSONSchema4,
    'Response',
    {
      bannerComment: '',
    },
  );

  await fs.writeFile(
    path.join(outDir, `${_.camelCase(scope)}.ts`),
    importOut + typesOut + out,
  );
};
