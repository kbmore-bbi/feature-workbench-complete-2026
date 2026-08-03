import { AiaBox, AiaButton, AiaInput, AiaSelect, AiaTableCellPrimitive, AiaTooltip } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { useState, type ReactNode } from 'react';

import type { SxProps, Theme } from '@mui/material/styles';
import { InfoOutlinedIcon } from '@/utils/icons';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';

import { aiaTableCellSx } from '@/components/ui/aia-table';
import { AiaAutocomplete } from '@/components/ui/aia-auto-complete';
import type { AiaAutocompleteOption } from '@/components/ui/aia-auto-complete';
import type { MappingMode } from '@/features/sttm/types/sttm.types';
import {
  MAPPING_TABLE_BODY_TEXT_SX,
  MAPPING_TABLE_SECONDARY_INPUT_SX,
  MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
} from '../mapping-table-styles';

type MappingSourceColumnsCellProps = {
  value: string | null;
  options: AiaAutocompleteOption[];
  onChange: (value: string) => void;
  mappingMode?: MappingMode;
  constantValue?: string | null;
  attributeName?: string | null;
  attributeOptions?: Array<{ label: string; value: string }>;
  onMappingModeChange?: (mode: MappingMode) => void;
  onConstantValueChange?: (value: string) => void;
  onAttributeChange?: (value: string) => void;
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
  firCandidates?: FIRMappingCandidate[];
  onApplyFirCandidate?: (candidate: FIRMappingCandidate) => void;
  onPrepareSource?: (candidate: FIRMappingCandidate) => void;
  onKeepUnresolved?: () => void;
  onUndoRecommendation?: () => void;
  recommendationUndoAvailable?: boolean;
  recommendationActionError?: string | null;
  sx?: SxProps<Theme>;
};

export type FIRMappingCandidate = {
  recommendationId: string;
  sourceColumn?: string | null;
  title: string;
  businessRationale?: string | null;
  evidenceSummary?: string | null;
  confidence?: number | null;
  compatibilityTier?: number | null;
  missingDependencies: string[];
  canApply: boolean;
  blockedReasons: string[];
  actionKind?: string | null;
  expectedWorkspaceHash?: string | null;
};

const DISABLED_SOURCE_FIELD_BG = '#f8fafc';

function compactCandidateLabels(candidates: string[]): Map<string, string> {
  const leafCounts = new Map<string, number>();
  candidates.forEach((candidate) => {
    const leaf = candidate.split('.').filter(Boolean).at(-1) ?? candidate;
    leafCounts.set(leaf.toUpperCase(), (leafCounts.get(leaf.toUpperCase()) ?? 0) + 1);
  });
  return new Map(candidates.map((candidate) => {
    const parts = candidate.split('.').filter(Boolean);
    const column = parts.at(-1) ?? candidate;
    const table = parts.at(-2);
    const label = (leafCounts.get(column.toUpperCase()) ?? 0) > 1 && table
      ? `${table}.${column}`
      : column;
    return [candidate, label];
  }));
}

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
  attributeName,
  attributeOptions = [],
  onMappingModeChange,
  onConstantValueChange,
  onAttributeChange,
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
  firCandidates = [],
  onApplyFirCandidate,
  onPrepareSource,
  onKeepUnresolved,
  onUndoRecommendation,
  recommendationUndoAvailable = false,
  recommendationActionError,
  sx,
}: MappingSourceColumnsCellProps) => {
  const [candidatesExpanded, setCandidatesExpanded] = useState(false);
  const visibleCandidates = Array.from(new Set(candidateSourceColumns))
    .filter((candidate) => candidate && candidate !== value)
    .slice(0, 3);
  const candidateLabels = compactCandidateLabels(visibleCandidates);
  const visibleFirCandidates = firCandidates.slice(0, 3);
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
        : mappingMode === "attribute"
          ? attributeName?.trim() ?? ""
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
            {displayValue || (
              mappingMode === "constant"
                ? "Enter a hard-coded value..."
                : mappingMode === "attribute"
                  ? "Select a project value..."
                  : "Use Pre-process to add source columns..."
            )}
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
          <AiaButton
            size="small"
            variant={mappingMode === "attribute" ? "contained" : "text"}
            onClick={() => onMappingModeChange?.("attribute")}
            sx={{
              minHeight: 26,
              px: 1,
              borderRadius: "6px",
              textTransform: "none",
              fontSize: "0.7rem",
              boxShadow: "none",
            }}
          >
            Project Value
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
            ) : mappingMode === "attribute" ? (
              <AiaSelect
                label=""
                fullWidth
                size="small"
                value={attributeName ?? ""}
                options={attributeOptions}
                placeholder="Select project value..."
                onChange={(next) => onAttributeChange?.(
                  Array.isArray(next) ? next[0] ?? "" : next,
                )}
                sx={{
                  ...MAPPING_TABLE_SECONDARY_INPUT_SX,
                  "& .MuiOutlinedInput-root": {
                    ...MAPPING_TABLE_SECONDARY_INPUT_TYPOGRAPHY,
                    minHeight: 38,
                    borderRadius: "6px",
                    bgcolor: attributeOptions.length === 0 ? DISABLED_SOURCE_FIELD_BG : "#fff",
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
        {mappingMode === "source" && (visibleFirCandidates.length || visibleCandidates.length) ? (
          <AiaBox sx={{ display: 'grid', gap: 0.5 }}>
            <AiaButton
              size="small"
              variant="text"
              aria-expanded={candidatesExpanded}
              onClick={() => setCandidatesExpanded((expanded) => !expanded)}
              sx={{
                justifySelf: 'start',
                minHeight: 24,
                p: 0,
                textTransform: 'none',
                fontSize: '0.7rem',
                fontWeight: 700,
              }}
            >
              {candidatesExpanded
                ? 'Hide candidates'
                : `Review candidates (${visibleFirCandidates.length || visibleCandidates.length})`}
            </AiaButton>
            {candidatesExpanded ? (
              <AiaBox
                role="list"
                aria-label="Recommended source columns"
                sx={{ display: 'grid', gap: 0.55 }}
              >
                {visibleFirCandidates.length ? visibleFirCandidates.map((candidate) => (
                  <AiaBox
                    key={candidate.recommendationId}
                    role="listitem"
                    sx={{
                      display: 'grid',
                      gap: 0.65,
                      p: 0.75,
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      bgcolor: '#f8fafc',
                    }}
                  >
                    <AiaBox sx={{ minWidth: 0 }}>
                      <AiaTooltip title={candidate.sourceColumn || candidate.title} placement="top" arrow>
                        <AiaText sx={{ fontSize: '0.72rem', fontWeight: 800, overflowWrap: 'anywhere' }}>
                          {candidate.sourceColumn
                            ? compactCandidateLabels([candidate.sourceColumn]).get(candidate.sourceColumn)
                            : candidate.title}
                        </AiaText>
                      </AiaTooltip>
                      <AiaText sx={{ mt: 0.2, fontSize: '0.66rem', color: '#475569', lineHeight: 1.4 }}>
                        {candidate.businessRationale || candidate.evidenceSummary || candidate.title}
                      </AiaText>
                      <AiaText sx={{ mt: 0.2, fontSize: '0.64rem', color: '#64748b', lineHeight: 1.35 }}>
                        {candidate.compatibilityTier === 1
                          ? 'Exact validated precedent'
                          : candidate.compatibilityTier === 3
                            ? 'Cross-CRM semantic adaptation'
                            : 'Compatible semantic match'}
                        {candidate.confidence != null
                          ? ` · ${Math.round(candidate.confidence * 100)}% confidence`
                          : ''}
                      </AiaText>
                      <AiaText sx={{ mt: 0.2, fontSize: '0.64rem', color: '#64748b', lineHeight: 1.35 }}>
                        Type, grain, relationship, and derived-output compatibility are checked during preview.
                        {candidate.missingDependencies.length
                          ? ` Missing: ${candidate.missingDependencies.join(', ')}.`
                          : ' No missing dependencies reported.'}
                      </AiaText>
                      {candidate.blockedReasons.length ? (
                        <AiaText sx={{ mt: 0.2, fontSize: '0.64rem', color: '#b45309', lineHeight: 1.35 }}>
                          {candidate.blockedReasons.join(' ')}
                        </AiaText>
                      ) : null}
                    </AiaBox>
                    <AiaBox sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {candidate.sourceColumn && candidate.canApply ? (
                        <AiaButton
                          size="small"
                          variant="outlined"
                          disabled={disabled}
                          onClick={() => onApplyFirCandidate?.(candidate)}
                          sx={{ minHeight: 26, px: 0.9, textTransform: 'none', fontSize: '0.68rem' }}
                        >
                          Apply
                        </AiaButton>
                      ) : (
                        <AiaButton
                          size="small"
                          variant="outlined"
                          onClick={() => onPrepareSource?.(candidate)}
                          sx={{ minHeight: 26, px: 0.9, textTransform: 'none', fontSize: '0.68rem' }}
                        >
                          Prepare Source
                        </AiaButton>
                      )}
                      <AiaButton
                        size="small"
                        variant="text"
                        onClick={() => {
                          onKeepUnresolved?.();
                          setCandidatesExpanded(false);
                        }}
                        sx={{ minHeight: 26, px: 0.9, textTransform: 'none', fontSize: '0.68rem' }}
                      >
                        Keep Unresolved
                      </AiaButton>
                    </AiaBox>
                  </AiaBox>
                )) : visibleCandidates.map((candidate, index) => (
                  <AiaBox
                    key={candidate}
                    role="listitem"
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                      gap: 0.75,
                      alignItems: 'center',
                      p: 0.75,
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      bgcolor: '#f8fafc',
                    }}
                  >
                    <AiaTooltip title={candidate} placement="top" arrow>
                      <AiaBox sx={{ minWidth: 0 }}>
                        <AiaText
                          sx={{
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {candidateLabels.get(candidate)}
                        </AiaText>
                        <AiaText
                          sx={{
                            mt: 0.15,
                            fontSize: '0.66rem',
                            color: '#64748b',
                            lineHeight: 1.35,
                          }}
                        >
                          {index === 0
                            ? confidenceReason || businessMeaning || 'Best compatible source candidate.'
                            : 'Alternative compatible source candidate.'}
                        </AiaText>
                      </AiaBox>
                    </AiaTooltip>
                    <AiaButton
                      size="small"
                      variant="outlined"
                      disabled={disabled}
                      onClick={() => onChange(candidate)}
                      sx={{
                        minHeight: 26,
                        px: 0.9,
                        textTransform: 'none',
                        fontSize: '0.68rem',
                      }}
                    >
                      Apply
                    </AiaButton>
                  </AiaBox>
                ))}
                {recommendationUndoAvailable ? (
                  <AiaButton
                    size="small"
                    variant="text"
                    onClick={onUndoRecommendation}
                    sx={{ justifySelf: 'start', minHeight: 26, px: 0, textTransform: 'none', fontSize: '0.68rem' }}
                  >
                    Undo recommendation
                  </AiaButton>
                ) : null}
                {recommendationActionError ? (
                  <AiaText role="alert" sx={{ fontSize: '0.66rem', color: '#b91c1c', lineHeight: 1.4 }}>
                    {recommendationActionError}
                  </AiaText>
                ) : null}
              </AiaBox>
            ) : null}
          </AiaBox>
        ) : null}
      </AiaBox>
    </AiaTableCellPrimitive>
  );
};
