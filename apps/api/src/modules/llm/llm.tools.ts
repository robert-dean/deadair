import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { LlmToolCall, LlmToolDeclaration } from '@deadair/plugin-sdk';
import type { Freshness } from '#modules/shared/freshness.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * The things a model may ask the station to do mid-sentence.
 *
 * ## Sources, not plugins
 *
 * A tool is a declaration the model reads and a function the HOST runs. Where that function comes
 * from is deliberately open: today the only source is the catalog, which is the station asking a
 * capability it already has. A `tool` plugin capability becomes a second source when something
 * outside the station is worth asking (weather, news, a feed), and nothing here changes when it
 * does. See `docs/todo/tool-plugins.md`.
 *
 * The distinction that keeps this from sprawling: a tool is a plugin when the thing it talks to is
 * somebody else's service. When it talks to deadair, it is a source registered here directly, and
 * routing it through a plugin would be a boundary crossing in a circle.
 *
 * ## A failed tool is an answer, not an exception
 *
 * The model asked a question and "that did not work" is a true answer to it. Handing that back as
 * text lets the model carry on and say something honest, where throwing would lose a whole
 * generation over a search that timed out. Nothing in this file throws at the loop.
 */

/** One thing the model can call. */
export interface StationTool {
    declaration: LlmToolDeclaration;

    /**
     * Whether what this answers with can stop being true between a break being written and aired.
     *
     * Required, and that is the whole of what it is for. `SUBSTRATE_FRESHNESS` asks this question of
     * every field a writer is HANDED, and cannot see a fact that reaches a script through the
     * conversation instead — a model that called `get_weather` and wrote the number down has put a
     * perishable claim in a script with nothing anywhere holding its expiry. A required field is
     * what makes a new tool source answer the question rather than never being asked it.
     *
     * **Nothing branches on this today, and the reason is measured**: every break writer passes
     * `tools: false` (`model.talk.break.writer.ts`, `model.news.break.writer.ts`,
     * `model.weather.break.writer.ts`, `model.story.break.writer.ts`, `model.welcome.writer.ts`), so
     * the only conversations that reach a tool are the set generator and the persona passes, and
     * neither puts a tool's answer on air as a statement about the present. That is exposure
     * DEFERRED rather than avoided: the day one of those five turns tools on, every `perishable`
     * below is a claim going to air with no expiry, and this field is the list of them.
     */
    freshness: Freshness;

    /**
     * Do it, and answer with something JSON-serializable.
     *
     * May throw: the registry turns a failure into a result the model can read. Doing that here
     * instead would mean every source reimplementing the same catch.
     */
    run(args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}

/** Somewhere tools come from. */
export interface ToolSource {
    /**
     * The tools available right now.
     *
     * Asked per conversation rather than cached at boot, because a source can change underneath
     * one: a plugin reconfigured by an operator is reinitialized immediately, and a catalog source
     * appears the moment a provider plugin is enabled.
     */
    tools(): Promise<StationTool[]>;
}

/**
 * How much of a tool's answer the model is shown.
 *
 * A search that matched four hundred tracks is not more useful to a DJ than one that matched ten,
 * and every character of it is context the model then has less room to think in — which on the
 * station's own hardware is the difference between a fast answer and one that spills VRAM. Truncated
 * rather than refused, because a long answer is still an answer.
 */
const MAX_RESULT_CHARS = 4_000;

@Injectable()
export class ToolRegistry {
    constructor(
        private readonly sources: readonly ToolSource[],
        private readonly logger: Logger,
    ) {}

    /**
     * Every tool on offer, keyed by name.
     *
     * First source wins a collision, and it is logged rather than thrown: a duplicate name means
     * two sources chose the same word, which should be fixed, but not by taking the station's whole
     * ability to write a break with it.
     */
    async tools(): Promise<Map<string, StationTool>> {
        const byName = new Map<string, StationTool>();

        for (const source of this.sources) {
            let offered: StationTool[];
            try {
                offered = await source.tools();
            } catch (error) {
                // A source that cannot say what it offers is a source with nothing to offer. The
                // conversation goes ahead with the rest.
                this.logger.warn(`llm: a tool source could not be asked what it offers (${errorText(error)})`);
                continue;
            }

            for (const tool of offered) {
                const name = tool.declaration.name;
                if (byName.has(name)) {
                    this.logger.warn(`llm: two tool sources both offer "${name}"; keeping the first`);
                    continue;
                }
                byName.set(name, tool);
            }
        }

        return byName;
    }

    /** What to send the model, out of {@link tools}. */
    async declarations(): Promise<LlmToolDeclaration[]> {
        return [...(await this.tools()).values()].map(tool => tool.declaration);
    }

    /**
     * Run one call and answer with the text to hand back.
     *
     * Always a string, and never a throw. The four things that can go wrong are all answers:
     * a name nothing offers, arguments that are not an object, a tool that failed, and a result too
     * big to show. A model told plainly which one happened can try something else; a model handed an
     * exception is a generation that ended.
     */
    async run(call: LlmToolCall, tools: Map<string, StationTool>, signal?: AbortSignal): Promise<string> {
        const tool = tools.get(call.name);
        if (tool === undefined) {
            const known = [...tools.keys()].join(', ');
            return `There is no tool called "${call.name}". Available: ${known.length > 0 ? known : 'none'}.`;
        }

        let result: unknown;
        try {
            result = await tool.run(call.arguments, signal);
        } catch (error) {
            this.logger.info(`llm: a tool call failed (${call.name}: ${errorText(error)})`);
            return `The tool "${call.name}" failed: ${errorText(error)}`;
        }

        return serialize(result, call.name);
    }
}

/** A tool's answer as text the model can read, bounded. */
function serialize(result: unknown, name: string): string {
    if (result === undefined) return `The tool "${name}" returned nothing.`;

    let text: string;
    try {
        text = JSON.stringify(result) ?? String(result);
    } catch (error) {
        // A cycle, or a BigInt. The tool's bug, and still not worth ending a generation over.
        return `The tool "${name}" returned something that could not be read: ${errorText(error)}`;
    }

    if (text.length <= MAX_RESULT_CHARS) return text;
    return `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated: the full result was ${text.length} characters]`;
}
