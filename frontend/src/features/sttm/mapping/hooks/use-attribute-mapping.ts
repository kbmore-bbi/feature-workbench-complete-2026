"use client";

import { useState } from 'react';

export default function useAttributeMapping() {
    const [mapping, setMapping] = useState<any[]>([]);

    const updateMapping = (newMapping: any[]) => {
        setMapping(newMapping);
    };

    return {
        mapping,
        updateMapping,
    };
}