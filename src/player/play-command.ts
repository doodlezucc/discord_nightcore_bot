export type Effects = {
    rate: number;
    bassboost: number;
    amplify: number;
};

export type PlayCommandParameters = Effects & {
    query: string;
};
