'use client';

import { useState } from 'react';
import { InputBase } from '@mui/material';
import { AiaBox, AiaIconButton, AiaPaper, AiaSelect, AiaStack } from '@/components/ui';
import { AIA_DATA_TABLE_FILTER_SELECT_SX } from '@/components/ui/aia-table/aia-data-table-styles';
import { textStyleCssVars } from '@/config/typography-tokens';
import { AiaText } from '@/components/ui/aia-text';
import { AddRoundedIcon, NorthIcon } from '@/utils/icons';

export type AiChatModel = 'auto' | 'cortex';

const MODEL_OPTIONS = [
    { label: 'Auto', value: 'auto' },
    { label: 'Cortex', value: 'cortex' },
];

type AiChatComposerProps = {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    disabled?: boolean;
    loading?: boolean;
};

export function AiChatComposer({
    value,
    onChange,
    onSend,
    disabled = false,
    loading = false,
}: AiChatComposerProps) {
    const [model, setModel] = useState<AiChatModel>('auto');

    const canSend = !loading && !disabled && value.trim().length > 0;

    return (
        <AiaBox sx={{ flexShrink: 0 }}>
            <AiaPaper
                elevation={0}
                sx={{
                    p: 1.5,
                    borderRadius: '16px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #d1d5db',
                    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
                }}
            >
                <InputBase
                    multiline
                    minRows={1}
                    maxRows={5}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            if (canSend) onSend();
                        }
                    }}
                    placeholder="Ask, build, @ for context, / for skills"
                    disabled={disabled || loading}
                    fullWidth
                    sx={{
                        width: '100%',
                        ...textStyleCssVars('body'),
                        alignItems: 'flex-start',
                        '& .MuiInputBase-input': {
                            padding: 0,
                            minHeight: 45,
                            fontSize: 'inherit',
                            fontWeight: 'inherit',
                            lineHeight: 'inherit',
                            color: 'inherit',
                        },
                        '& .MuiInputBase-input::placeholder': {
                            color: '#94a3b8',
                            opacity: 1,
                        },
                    }}
                />

                <AiaStack
                    direction="row"
                    spacing={0.75}
                    sx={{
                        mt: 0.75,
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <AiaStack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                        <AiaIconButton
                            size="small"
                            aria-label="Add context"
                            title="Add context (coming soon)"
                            disabled={disabled || loading}
                            onClick={() => undefined}
                            sx={{
                                width: 38,
                                height: 38,
                                border: '1px solid #e2e8f0',
                                borderRadius: '50%',
                                color: '#475569',
                                backgroundColor: '#ffffff',
                                flexShrink: 0,
                                '&:hover': { backgroundColor: '#f8fafc' },
                            }}
                        >
                            <AddRoundedIcon sx={{ fontSize: 22 }} />
                        </AiaIconButton>

                        <AiaSelect
                            value={model}
                            options={MODEL_OPTIONS}
                            onChange={(next) =>
                                setModel((Array.isArray(next) ? next[0] : next) as AiChatModel)
                            }
                            disabled={disabled || loading}
                            fullWidth={false}
                            size="small"
                            sx={{
                                ...AIA_DATA_TABLE_FILTER_SELECT_SX,
                                width: 'auto',
                                minWidth: 96,
                            }}
                        />
                    </AiaStack>

                    <AiaIconButton
                        size="small"
                        aria-label="Send message"
                        onClick={onSend}
                        disabled={!canSend}
                        sx={{
                            width: 38,
                            height: 38,
                            p: 0,
                            color: '#ffffff',
                            backgroundColor: canSend ? 'var(--color-primary, #0073a0)' : '#cbd5e1',
                            borderRadius: '50%',
                            flexShrink: 0,
                            boxShadow: canSend ? '0 1px 2px rgba(0, 115, 160, 0.28)' : 'none',
                            '&:hover': {
                                backgroundColor: canSend ? 'var(--color-primary, #0073a0)' : '#cbd5e1',
                            },
                            '&.Mui-disabled': {
                                color: '#ffffff',
                                backgroundColor: '#cbd5e1',
                            },
                        }}
                    >
                        <NorthIcon sx={{ fontSize: 22 }} />
                    </AiaIconButton>
                </AiaStack>
            </AiaPaper>

            <AiaText sx={{ mt: 1, textAlign: 'center', fontSize: 11, color: '#94a3b8' }}>
                STTM AI can make mistakes. Double-check responses.
            </AiaText>
        </AiaBox>
    );
}
