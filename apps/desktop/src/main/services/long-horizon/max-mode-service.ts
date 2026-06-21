export interface MaxCandidateSession {
    id: string;
    prompt: (prompt: string) => Promise<void>;
    readResult: () => string;
    dispose?: () => void | Promise<void>;
}

export interface MaxCandidateResult {
    id: string;
    content: string;
}

export interface MaxJudgeResult {
    winnerId: string;
    reason: string;
}

export interface MaxModeServiceOptions {
    candidates?: number;
    createCandidate: (index: number) => Promise<MaxCandidateSession>;
    judge: (candidates: MaxCandidateResult[]) => Promise<MaxJudgeResult>;
}

export interface MaxModeRunInput {
    prompt: string;
    replayWinner: (content: string) => Promise<void>;
}

export interface MaxModeRunResult extends MaxJudgeResult {
    overhead: {
        candidates: number;
        promptChars: number;
        resultChars: number;
    };
}

export class MaxModeService {
    constructor(private readonly options: MaxModeServiceOptions) {}

    async run(input: MaxModeRunInput): Promise<MaxModeRunResult> {
        const count = this.options.candidates ?? 5;
        const sessions: MaxCandidateSession[] = [];
        try {
            for (let i = 1; i <= count; i += 1) {
                sessions.push(await this.options.createCandidate(i));
            }
            await Promise.all(sessions.map((session) => session.prompt(input.prompt)));
            const candidates = sessions.map((session) => ({
                id: session.id,
                content: session.readResult(),
            }));
            const judged = await this.options.judge(candidates);
            const winner = candidates.find((candidate) => candidate.id === judged.winnerId) ?? candidates[0];
            if (!winner) throw new Error("Max mode produced no candidates");
            await input.replayWinner(winner.content);
            return {
                ...judged,
                winnerId: winner.id,
                overhead: {
                    candidates: candidates.length,
                    promptChars: input.prompt.length * candidates.length,
                    resultChars: candidates.reduce((sum, candidate) => sum + candidate.content.length, 0),
                },
            };
        } finally {
            await Promise.all(sessions.map((session) => session.dispose?.()));
        }
    }
}
