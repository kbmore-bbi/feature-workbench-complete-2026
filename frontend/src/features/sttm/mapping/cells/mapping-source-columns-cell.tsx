import { AiaBox, AiaButton, AiaInput, AiaTableCellPrimitive, AiaTooltip } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import type { ReactNode } from 'react';

import type { SxProps, Theme } from '@mui/material/styles';
import { InfoOutlinedIcon } from '@/utils/icons';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';

import { aiaTableCellSx } from '@/components/ui/aia-table';
import { AiaAutocomplete } from '@/components/ui/aia-auto-complete';
import type { AiaAutocompleteOption } from '@/components/ui/aia-auto-complete';
import {
  MAPPING_TABLE_BODY_TEXT_SX,
  MAPPING_TABLE_SECONDARY_INPUT_SX,
  MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
} from '../mapping-table-styles';

type MappingSourceColumnsCellProps = {
  value: string | null;
  options: AiaAutocompleteOption[];
  onChange: (value: string) => void;
  mappingMode?: "source" | "constant";
  constantValue?: string | null;
  onMappingModeChange?: (mode: "source" | "constant") => void;
  onConstantValueChange?: (value: string) => void;
  disabled?: boolean;
  displayAsPlainText?: boolean;
  width?: number | string;
  minWidth?: number | string;
  confidenceScore?: number | null;
  confidenceReason?: string | null;
  businessMeaning?: string | null;
  candidateSourceColumns?: string[];
  unmatchedReason?: string | null;
  usedInferenceIds?: string[];
  usedRecommendationIds?: string[];
  usedLearningIds?: string[];
  sx?: SxProps<Theme>;
};

const DISABLED_SOURCE_FIELD_BG = '#f8fafc';

function ConfidenceMeta({
  confidenceScore,
  helperText,
}: {
  confidenceScore?: number | null;
  helperText: ReactNode;
}) {
  if (confidenceScore !== null && confidenceScore !== undefined) {
    return (
      <AiaBox
        data-tour={TOUR_TARGETS.sttmConfidenceScore}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 0.5,
          minWidth: 54,
          pt: 0.15,
          flexShrink: 0,
        }}
      >
        <AiaText
          sx={{
            fontSize: '0.68rem',
            fontWeight: 800,
            color:
              confidenceScore >= 0.8
                ? '#166534'
                : confidenceScore >= 0.55
                  ? '#92400e'
                  : '#b91c1c',
          }}
        >
          {Math.round(confidenceScore * 100)}%
        </AiaText>

        {helperText ? (
          <AiaTooltip
            title={helperText}
            placement="top"
            arrow
            enterDelay={200}
            slotProps={{
              tooltip: {
                sx: {
                  fontSize: '0.72rem',
                  maxWidth: 360,
                  lineHeight: 1.5,
                },
              },
            }}
          >
            <InfoOutlinedIcon sx={{ fontSize: 15, color: '#64748b', cursor: 'help' }} />
          </AiaTooltip>
        ) : null}
      </AiaBox>
    );
  }

  if (!helperText) {
    return null;
  }

  return (
    <AiaBox sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 24, pt: 0.15, flexShrink: 0 }}>
      <AiaTooltip
        title={helperText}
        placement="top"
        arrow
        enterDelay={200}
        slotProps={{
          tooltip: {
            sx: {
              fontSize: '0.72rem',
              maxWidth: 360,
              lineHeight: 1.5,
            },
          },
        }}
      >
        <InfoOutlinedIcon sx={{ fontSize: 15, color: '#64748b', cursor: 'help' }} />
      </AiaTooltip>
    </AiaBox>
  );
}

export const MappingSourceColumnsCell = ({
  value,
  options,
  onChange,
  mappingMode = "source",
  constantValue,
  onMappingModeChange,
  onConstantValueChange,
  disabled = false,
  displayAsPlainText = false,
  width,
  minWidth,
  confidenceScore,
  confidenceReason,
  businessMeaning,
  candidateSourceColumns = [],
  unmatchedReason,
  usedInferenceIds = [],
  usedRecommendationIds = [],
  usedLearningIds = [],
  sx,
}: MappingSourceColumnsCellProps) => {
  const reasonText =
    confidenceReason ||
    unmatchedReason ||
    (candidateSourceColumns.length
      ? `Best alternatives: ${candidateSourceColumns.join(', ')}`
      : '');
  const confidenceBand = confidenceScore == null
    ? null
    : confidenceScore >= 0.8
      ? "High confidence"
      : confidenceScore >= 0.55
        ? "Medium confidence"
        : "Low confidence";
  const reviewGuidance = confidenceScore == null
    ? null
    : confidenceScore >= 0.8
      ? "The source meaning, type, and learned mapping pattern agree. Confirm the business rule before publishing."
      : confidenceScore >= 0.55
        ? "The candidate is plausible, but at least one semantic or precedent signal is incomplete. Review the source and preprocessing rule."
        : "The available evidence is weak or conflicting. Select a source, Value binding, or derived output explicitly before publishing.";
  const evidenceTopics = [
    usedInferenceIds.length
      ? "Selected-table semantics and inferred business meaning"
      : null,
    usedRecommendationIds.length
      ? "A FIR recommendation matched to this source/target context"
      : null,
    usedLearningIds.length
      ? "Prior accepted or published mapping behavior"
      : null,
  ].filter(Boolean) as string[];
  const helperText = [confidenceBand, businessMeaning, reasonText, ...evidenceTopics, reviewGuidance].filter(Boolean).join('\n');
  const tooltipContent = helperText ? (
    <AiaBox sx={{ display: 'grid', gap: 0.7, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
      {confidenceBand ? <AiaText sx={{ fontSize: 'inherit', lineHeight: 'inherit', fontWeight: 800 }}>{confidenceBand}</AiaText> : null}
      {businessMeaning ? (
        <AiaText sx={{ fontSize: 'inherit', lineHeight: 'inherit' }}>
          <strong>Business fit:</strong> {businessMeaning}
        </AiaText>
      ) : null}
      {reasonText ? <AiaText sx={{ fontSize: 'inherit', lineHeight: 'inherit' }}><strong>Why:</strong> {reasonText}</AiaText> : null}
      {evidenceTopics.length ? (
        <AiaBox sx={{ display: 'grid', gap: 0.25 }}>
          <AiaText sx={{ fontSize: 'inherit', lineHeight: 'inherit', fontWeight: 800 }}>Evidence considered</AiaText>
          {evidenceTopics.map((topic) => (
            <AiaText key={topic} sx={{ fontSize: 'inherit', lineHeight: 'inherit' }}>• {topic}</AiaText>
          ))}
        </AiaBox>
      ) : null}
      {candidateSourceColumns.length ? (
        <AiaText sx={{ fontSize: 'inherit', lineHeight: 'inherit' }}>
          <strong>Compared candidates:</strong> {candidateSourceColumns.slice(0, 4).join(', ')}
        </AiaText>
      ) : null}
      {reviewGuidance ? <AiaText sx={{ fontSize: 'inherit', lineHeight: 'inherit' }}><strong>What to do:</strong> {reviewGuidance}</AiaText> : null}
    </AiaBox>
  ) : null;

  if (displayAsPlainText) {
    const displayValue =
      mappingMode === "constant"
        ? constantValue?.trim() ?? ""
        : value?.trim() ?? '';

    return (
      <AiaTableCellPrimitive sx={aiaTableCellSx({ width, minWidth, sx })}>
        <AiaBox
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 0.9,
          }}
        >
          <AiaText
            component="div"
            sx={{
              flex: 1,
              minWidth: 0,
              ...MAPPING_TABLE_BODY_TEXT_SX,
              color: displayValue ? undefined : '#94a3b8',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
              lineHeight: 1.45,
            }}
          >
            {displayValue || (mappingMode === "constant"
              ? "Enter a hard-coded value..."
              : "Use Pre-process to add source columns...")}
          </AiaText>

          <ConfidenceMeta confidenceScore={confidenceScore} helperText={tooltipContent ?? ''} />
        </AiaBox>
      </AiaTableCellPrimitive>
    );
  }

  return (
    <AiaTableCellPrimitive sx={aiaTableCellSx({ width, minWidth, sx }, { overflow: 'hidden' })}>
      <AiaBox sx={{ display: 'grid', gap: 0.55 }}>
        <AiaBox sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <AiaButton
            size="small"
            variant={mappingMode === "source" ? "contained" : "text"}
            onClick={() => onMappingModeChange?.("source")}
            sx={{
              minHeight: 26,
              px: 1,
              borderRadius: "6px",
              textTransform: "none",
              fontSize: "0.7rem",
              boxShadow: "none",
            }}
          >
            Column
          </AiaButton>
          <AiaButton
            size="small"
            variant={mappingMode === "constant" ? "contained" : "text"}
            onClick={() => onMappingModeChange?.("constant")}
            sx={{
              minHeight: 26,
              px: 1,
              borderRadius: "6px",
              textTransform: "none",
              fontSize: "0.7rem",
              boxShadow: "none",
            }}
          >
            Value
          </AiaButton>
        </AiaBox>
        <AiaBox
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 0.9,
          }}
        >
          <AiaBox sx={{ minWidth: 0, flex: 1 }}>
            {mappingMode === "constant" ? (
              <AiaInput
                fullWidth
                size="small"
                value={constantValue ?? ""}
                onChange={(next) => onConstantValueChange?.(next)}
                placeholder="Enter value, or NULL"
                sx={{
                  ...MAPPING_TABLE_SECONDARY_INPUT_SX,
                  "& .MuiOutlinedInput-root": {
                    ...MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
                    minHeight: 38,
                    borderRadius: "6px",
                    backgroundColor: "#fff",
                  },
                }}
              />
            ) : (
              <AiaAutocomplete
              hideLabel
              freeSolo
              fullWidth
              size="small"
              disabled={disabled}
              value={value ?? ''}
              options={options}
              placeholder={
                disabled
                  ? 'Select a pre-processing rule first...'
                  : 'Type to map source columns...'
              }
              groupBy={(option) => option.group ?? ''}
              onChange={(next) => onChange(Array.isArray(next) ? next[0] ?? '' : next)}
              sx={{
                ...MAPPING_TABLE_SECONDARY_INPUT_SX,
                '& .MuiOutlinedInput-root': {
                  ...MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
                  minHeight: 38,
                  borderRadius: '6px',
                  bgcolor: disabled ? DISABLED_SOURCE_FIELD_BG : '#fff',
                  ...(disabled
                    ? {
                        opacity: 1,
                        '& .MuiOutlinedInput-notchedOutline': {
                          borderColor: DISABLED_SOURCE_FIELD_BG,
                        },
                        '&.Mui-disabled .MuiOutlinedInput-notchedOutline': {
                          borderColor: `${DISABLED_SOURCE_FIELD_BG} !important`,
                        },
                        '& .MuiInputBase-input.Mui-disabled': {
                          WebkitTextFillColor: '#94a3b8',
                        },
                      }
                    : {
                        '& .MuiOutlinedInput-notchedOutline': {
                          borderColor: '#e5e7eb',
                        },
                      }),
                },
                '& .MuiInputBase-input, & .MuiAutocomplete-input': {
                  ...MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
                  paddingY: '7px !important',
                },
              }}
              />
            )}
          </AiaBox>

          <ConfidenceMeta confidenceScore={confidenceScore} helperText={tooltipContent ?? ''} />
        </AiaBox>
      </AiaBox>
    </AiaTableCellPrimitive>
  );
};
