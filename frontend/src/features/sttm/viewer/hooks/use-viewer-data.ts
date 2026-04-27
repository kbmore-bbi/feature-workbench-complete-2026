"use client";

import { useState } from 'react';


export default function useViewerData() {
    const [viewerData, setViewerData] = useState<any>(null);

    const updateViewerData = (data: any) => {
        setViewerData(data);
    };

    return {
        viewerData,
        updateViewerData,
    };
}