import type {
  CreateEmulsifierOptions,
  Emulsifier,
  EmulsifierCreator,
  EmulsifierFactoryContext,
  EmulsifierType,
} from "./types.ts";

export class EmulsifierFactory {
  readonly #creators = new Map<EmulsifierType, EmulsifierCreator<unknown>>();

  register<TOptions>(
    type: EmulsifierType,
    create: EmulsifierCreator<TOptions>,
  ): this {
    this.#creators.set(type, create as EmulsifierCreator<unknown>);
    return this;
  }

  unregister(type: EmulsifierType): boolean {
    return this.#creators.delete(type);
  }

  has(type: EmulsifierType): boolean {
    return this.#creators.has(type);
  }

  list(): EmulsifierType[] {
    return [...this.#creators.keys()].sort();
  }

  create<TOptions>(
    definition: CreateEmulsifierOptions<TOptions>,
    context: EmulsifierFactoryContext,
  ): Emulsifier {
    const creator = this.#creators.get(definition.type);

    if (!creator) {
      throw new Error(`Unknown emulsifier type: ${definition.type}`);
    }

    return creator(definition.options, context);
  }

  clear(): void {
    this.#creators.clear();
  }
}

export const emulsifierFactory = new EmulsifierFactory();

export function createEmulsifier<TOptions>(
  definition: CreateEmulsifierOptions<TOptions>,
  context: EmulsifierFactoryContext,
): Emulsifier {
  return emulsifierFactory.create(definition, context);
}
