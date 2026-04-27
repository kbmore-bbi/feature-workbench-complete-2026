"use client";

import { useState } from 'react';


export default function useValidationRules() {
    const [rules, setRules] = useState<string[]>([]);

    const addRule = (rule: string) => {
        setRules(prevRules => [...prevRules, rule]);
    };

    const removeRule = (rule: string) => {
        setRules(prevRules => prevRules.filter(r => r !== rule));
    };

    return {
        rules,
        addRule,
        removeRule,
    };
}