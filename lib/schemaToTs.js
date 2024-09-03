"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.schemaToTs = void 0;
const json_schema_to_typescript_1 = require("json-schema-to-typescript");
const fs_1 = require("fs");
const lodash_1 = __importDefault(require("lodash"));
const path_1 = __importDefault(require("path"));
const json_schema_ref_parser_1 = __importDefault(require("@apidevtools/json-schema-ref-parser"));
const debug_1 = __importDefault(require("debug"));
const log = (0, debug_1.default)('schemaToTs');
const fixEnum = (o) => {
    if (o.type === 'string' && o.enum && o.enum.length === 0) {
        o.type = 'object';
        delete o.enum;
    }
    return o;
};
const fixEmptyEnums = (o) => {
    for (const [, dVal] of Object.entries(o)) {
        fixEnum(dVal);
    }
    return o;
};
const schemaToTs = async (filePath, scope, outDir) => {
    log('schemaToTs', filePath, scope, outDir);
    const file = JSON.parse(await fs_1.promises.readFile(filePath, 'utf-8'));
    let importOut = `import { CosmWasmClient, SigningCosmWasmClient, ExecuteResult, InstantiateResult } from "@cosmjs/cosmwasm-stargate"; 
import { StdFee } from "@cosmjs/amino";
`;
    let out = ``;
    let typesOut = '';
    const queryMap = {};
    let hasCoin = false;
    let definitions = {};
    const globalSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: `${scope}Schema`,
        type: 'object',
        required: [],
        properties: {},
    };
    if (file.responses && Object.keys(file.responses).length) {
        globalSchema.required.push('responses');
        globalSchema.properties.responses = {
            type: 'object',
            oneOf: [],
        };
        for (const [fnName, value] of Object.entries(file.responses)) {
            const title = value.title;
            log('old title', title);
            const newTitle = lodash_1.default.upperFirst(lodash_1.default.camelCase(title));
            log('new title', newTitle);
            fixEnum(value);
            if (value.title === 'Coin') {
                hasCoin = true;
            }
            if (value.definitions) {
                definitions = { ...definitions, ...value.definitions };
            }
            value.title = newTitle;
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
  mustBeSigningClient(): Error {
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
        definitions = { ...definitions, ...file.query.definitions };
        let wasRequired = false;
        for (const query of file.query.oneOf) {
            const queryName = query.required ? query.required[0] : query.enum[0];
            const outType = queryMap[queryName];
            const inType = query.properties && query.properties[queryName];
            log('generating query', queryName);
            if (inType && inType.properties) {
                wasRequired = true;
                const compType = {
                    ...inType,
                    title: `${queryName}Args`,
                };
                globalSchema.properties.query.oneOf.push(compType);
                out += `  query${lodash_1.default.upperFirst(lodash_1.default.camelCase(queryName))} = async(args: ${lodash_1.default.upperFirst(lodash_1.default.camelCase(queryName))}Args): Promise<${outType}> => {
    return this.client.queryContractSmart(this.contractAddress, { ${queryName}: args });
  }
`;
            }
            else {
                out += `  query${lodash_1.default.upperFirst(lodash_1.default.camelCase(queryName))} = async(): Promise<${outType}> => {
    return this.client.queryContractSmart(this.contractAddress, { ${queryName}: {} });
  }
`;
            }
        }
        if (!wasRequired) {
            delete globalSchema.properties.query;
        }
        else {
            globalSchema.required.push('query');
        }
    }
    log('query compiled');
    if (file.execute && file.execute.oneOf) {
        log('adding execute');
        definitions = { ...definitions, ...file.execute.definitions };
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
                out += `  ${lodash_1.default.camelCase(executeName)} = async(sender:string, args: ${lodash_1.default.upperFirst(lodash_1.default.camelCase(executeName))}Args, fee?: number | StdFee | "auto", memo?: string, funds?: Coin[]): Promise<ExecuteResult> =>  {
          if (!isSigningCosmWasmClient(this.client)) { throw this.mustBeSigningClient(); }
    return this.client.execute(sender, this.contractAddress, this.${lodash_1.default.camelCase(executeName)}Msg(args), fee || "auto", memo, funds);
  }
  ${lodash_1.default.camelCase(executeName)}Msg = (args: ${lodash_1.default.upperFirst(lodash_1.default.camelCase(executeName))}Args): { ${executeName}: ${lodash_1.default.upperFirst(lodash_1.default.camelCase(executeName))}Args } => { return { ${executeName}: args }; }
`;
            }
            else {
                out += `  ${lodash_1.default.camelCase(executeName)} = async(sender: string, fee?: number | StdFee | "auto", memo?: string, funds?: Coin[]): Promise<ExecuteResult> =>  {
          if (!isSigningCosmWasmClient(this.client)) { throw this.mustBeSigningClient(); }
    return this.client.execute(sender, this.contractAddress, this.${lodash_1.default.camelCase(executeName)}Msg(), fee || "auto", memo, funds);
  }
  ${lodash_1.default.camelCase(executeName)}Msg = (): { ${executeName}: {} } => { return { ${executeName}: {} } }
`;
            }
        }
        if (!wasRequired) {
            delete globalSchema.properties.execute;
        }
        else {
            globalSchema.required.push('execute');
        }
    }
    log('execute compiled');
    out += `}
`;
    if (file.instantiate) {
        globalSchema.properties.instantiate = file.instantiate;
        definitions = { ...definitions, ...file.instantiate.definitions };
    }
    globalSchema.definitions = fixEmptyEnums(definitions);
    if (!hasCoin && !globalSchema.definitions.Coin) {
        importOut += `import { Coin } from "@cosmjs/amino";
`;
    }
    const x = globalSchema;
    typesOut += await (0, json_schema_to_typescript_1.compile)((await json_schema_ref_parser_1.default.dereference(x)), 'Response', {
        bannerComment: '',
    });
    await fs_1.promises.writeFile(path_1.default.join(outDir, `${lodash_1.default.camelCase(scope)}.ts`), importOut + typesOut + out);
};
exports.schemaToTs = schemaToTs;
function fixUints(o) {
    if (o.properties)
        for (const [k, v] of Object.entries(o.properties)) {
            if (v.format && v.format.startsWith('uint')) {
                o.properties[k] = {
                    type: 'string',
                };
            }
        }
    return o;
}
function applyToKeys(obj) {
    for (const [k, v] of Object.entries(obj)) {
        obj[k] = fixUints(v);
    }
    return obj;
}
