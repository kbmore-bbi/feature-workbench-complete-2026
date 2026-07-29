"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AiaBox } from "@/components/ui";

import AttributesHeader from "./attributes-header";
import AttributesTable from "./attributes-table";
import DeleteAttributeModal from "./delete-attribute-modal";
import ImportAttributesModal from "./import-attributes-modal";
import NewAttributeModal from "./new-attribute-modal";
import {
  MOCK_HARDCODED_ATTRIBUTES,
  type HardcodedAttribute,
  type NewAttributeFormValues,
} from "./attributes-data";

function AttributesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() || "";
  const projectName = searchParams.get("project_name")?.trim() || "";

  const [attributes, setAttributes] = useState<HardcodedAttribute[]>([]);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingAttribute, setEditingAttribute] = useState<HardcodedAttribute | null>(null);
  const [deletingAttribute, setDeletingAttribute] = useState<HardcodedAttribute | null>(null);

  useEffect(() => {
    if (!projectId) {
      setAttributes([]);
      return;
    }
    setAttributes(
      MOCK_HARDCODED_ATTRIBUTES.filter(
        (item) =>
          item.projectId === projectId ||
          item.projectName.trim().toLowerCase() === projectName.trim().toLowerCase(),
      ).map((item) => ({
        ...item,
        projectId,
        projectName,
        importProjectName: null,
      })),
    );
  }, [projectId, projectName]);

  const filteredAttributes = useMemo(
    () =>
      projectId
        ? attributes.filter((item) => item.projectId === projectId)
        : attributes,
    [attributes, projectId],
  );

  const handleOpenCreate = () => {
    setModalMode("create");
    setEditingAttribute(null);
    setIsFormModalOpen(true);
  };

  const handleOpenEdit = (row: HardcodedAttribute) => {
    setModalMode("edit");
    setEditingAttribute(row);
    setIsFormModalOpen(true);
  };

  const handleCloseFormModal = () => {
    setIsFormModalOpen(false);
    setEditingAttribute(null);
    setModalMode("create");
  };

  const handleSubmitAttribute = (values: NewAttributeFormValues) => {
    if (modalMode === "edit" && editingAttribute) {
      setAttributes((current) =>
        current.map((item) =>
          item.id === editingAttribute.id
            ? {
                ...item,
                attributeName: values.attributeName,
                attributeType: values.attributeType,
                projectName: values.projectName,
                attributeValue: values.attributeValue,
              }
            : item,
        ),
      );
      return;
    }

    const next: HardcodedAttribute = {
      id: `attr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      attributeName: values.attributeName,
      attributeType: values.attributeType,
      projectId: projectId || "unknown",
      projectName: values.projectName,
      importProjectName: null,
      attributeValue: values.attributeValue,
    };
    setAttributes((current) => [next, ...current]);
  };

  const handleImportAttributes = (rows: HardcodedAttribute[]) => {
    setAttributes((current) => {
      const existingIds = new Set(current.map((item) => item.id));
      const existingNames = new Set(
        current
          .filter((item) => item.projectId === projectId)
          .map((item) => item.attributeName),
      );

      const imported = rows
        .filter((row) => !existingNames.has(row.attributeName))
        .map((row) => {
          const nextId = existingIds.has(row.id)
            ? `attr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            : row.id;
          existingIds.add(nextId);
          existingNames.add(row.attributeName);
          return {
            ...row,
            id: nextId,
            projectId,
            projectName,
            importProjectName: row.projectName,
          };
        });

      return [...imported, ...current];
    });
  };

  const handleConfirmDelete = () => {
    if (!deletingAttribute) {
      return;
    }
    setAttributes((current) => current.filter((item) => item.id !== deletingAttribute.id));
    setDeletingAttribute(null);
  };

  if (!projectId || !projectName) {
    return (
      <AiaBox
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1.5,
          bgcolor: "#F7F8FA",
          px: 3,
          textAlign: "center",
        }}
      >
        <AiaBox sx={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
          Project context required
        </AiaBox>
        <AiaBox sx={{ fontSize: 13, color: "#64748B", maxWidth: 420 }}>
          Open Hardcoded Values from a project card so project ID and name are passed in the route.
        </AiaBox>
        <AiaBox
          component="button"
          onClick={() => router.push("/projects")}
          sx={{
            mt: 1,
            border: "1px solid #E5E7EB",
            borderRadius: "10px",
            bgcolor: "#FFFFFF",
            color: "#111827",
            fontSize: 13,
            fontWeight: 600,
            px: 2,
            py: 1,
            cursor: "pointer",
          }}
        >
          Back to Projects
        </AiaBox>
      </AiaBox>
    );
  }

  return (
    <>
      <AiaBox
        sx={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          flexDirection: "column",
          overflow: "hidden",
          bgcolor: "#F7F8FA",
        }}
      >
        <AiaBox
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            px: { xs: 2.5, md: 3.5 },
            py: 2.5,
          }}
        >
          <AttributesHeader
            projectName={projectName}
            onImportAttributes={() => setIsImportModalOpen(true)}
            onCreateAttribute={handleOpenCreate}
          />

          <AiaBox sx={{ mt: 2.5 }}>
            <AttributesTable
              variant="landing"
              rows={filteredAttributes}
              onEdit={handleOpenEdit}
              onDelete={setDeletingAttribute}
            />
          </AiaBox>
        </AiaBox>
      </AiaBox>

      <NewAttributeModal
        open={isFormModalOpen}
        projectName={projectName}
        mode={modalMode}
        initialValues={editingAttribute}
        onClose={handleCloseFormModal}
        onSubmit={handleSubmitAttribute}
      />

      <ImportAttributesModal
        open={isImportModalOpen}
        currentProjectId={projectId}
        currentProjectName={projectName}
        onClose={() => setIsImportModalOpen(false)}
        onImport={handleImportAttributes}
      />

      <DeleteAttributeModal
        open={Boolean(deletingAttribute)}
        attribute={deletingAttribute}
        onClose={() => setDeletingAttribute(null)}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

export default function AttributesPage() {
  return (
    <Suspense
      fallback={
        <AiaBox
          sx={{
            flex: 1,
            minHeight: 0,
            bgcolor: "#F7F8FA",
          }}
        />
      }
    >
      <AttributesPageContent />
    </Suspense>
  );
}
