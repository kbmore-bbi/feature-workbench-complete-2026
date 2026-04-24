"use client";

import { useState } from 'react';

export default function useSourceTargetSelection() {
    const [source, setSource] = useState<string | null>(null);
    const [target, setTarget] = useState<string | null>(null);

    const selectSource = (sourceId: string) => {
        setSource(sourceId);
    };

    const selectTarget = (targetId: string) => {
        setTarget(targetId);
    };

    return {
        source,
        target,
        selectSource,
        selectTarget,
    };
}