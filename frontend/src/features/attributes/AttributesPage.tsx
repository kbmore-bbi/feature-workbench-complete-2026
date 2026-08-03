"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Modal/page state is reset when project context changes. */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AiaBox, AiaButton } from "@/components/ui";

import AttributesHeader from "./attributes-header";
import AttributesTable from "./attributes-table";
import DeleteAttributeModal from "./delete-attribute-modal";
import ImportAttributesModal from "./import-attributes-modal";
import NewAttributeModal from "./new-attribute-modal";
import {
  type HardcodedAttribute,
  type NewAttributeFormValues,
} from "./attributes-data";
import {
  createProjectAttribute,
  deleteProjectAttribute,
  importProjectAttributes,
  listProjectAttributes,
  updateProjectAttribute,
  type ProjectAttributeRecord,
} from "@/services/projectService";

function toHardcodedAttribute(record: ProjectAttributeRecord): HardcodedAttribute {
  return {
    id: record.attribute_id,
    attributeName: record.attribute_name,
    attributeType: record.attribute_type as HardcodedAttribute["attributeType"],
    projectId: record.project_id,
    projectName: record.project_name ?? "",
    importProjectName: record.source_project_name ?? null,
    attributeValue: record.attribute_value,
  };
}

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const loadAttributes = useCallback(async () => {
    if (!projectId) {
      setAttributes([]);
      return;
    }
    setLoadError(null);
    try {
      const records = await listProjectAttributes(projectId);
      setAttributes(records.map(toHardcodedAttribute));
    } catch (error) {
      setAttributes([]);
      setLoadError(
        error instanceof Error
          ? error.message
          : "Unable to load Project Values from the metadata service.",
      );
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setAttributes([]);
      return;
    }
    void loadAttributes();
  }, [loadAttributes, projectName, reloadToken]);

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
      void updateProjectAttribute(projectId, editingAttribute.id, {
        attribute_name: values.attributeName,
        attribute_type: values.attributeType,
        attribute_value: values.attributeValue,
      }).then((record) => {
        setAttributes((current) => current.map((item) =>
          item.id === editingAttribute.id ? toHardcodedAttribute(record) : item,
        ));
      }).catch((error) => {
        setLoadError(error instanceof Error ? error.message : "Unable to update project value.");
      });
      return;
    }
    void createProjectAttribute(projectId, {
      attribute_name: values.attributeName,
      attribute_type: values.attributeType,
      attribute_value: values.attributeValue,
    }).then((record) => {
      setAttributes((current) => [toHardcodedAttribute(record), ...current]);
    }).catch((error) => {
      setLoadError(error instanceof Error ? error.message : "Unable to create project value.");
    });
  };

  const handleImportAttributes = (rows: HardcodedAttribute[]) => {
    const byProject = new Map<string, string[]>();
    rows.forEach((row) => {
      byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row.id]);
    });
    void Promise.all(
      Array.from(byProject.entries()).map(([sourceProjectId, attributeIds]) =>
        importProjectAttributes(projectId, {
          source_project_id: sourceProjectId,
          attribute_ids: attributeIds,
        }),
      ),
    ).then(() => listProjectAttributes(projectId))
      .then((records) => setAttributes(records.map(toHardcodedAttribute)))
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : "Unable to import project values.");
      });
  };

  const handleConfirmDelete = () => {
    if (!deletingAttribute) {
      return;
    }
    const attributeId = deletingAttribute.id;
    setDeletingAttribute(null);
    void deleteProjectAttribute(projectId, attributeId)
      .then(() => setAttributes((current) => current.filter((item) => item.id !== attributeId)))
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : "Unable to delete project value.");
      });
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
          {loadError ? (
            <AiaBox sx={{ mt: 1.5, display: "flex", alignItems: "center", gap: 1.5, color: "#DC2626", fontSize: 12 }}>
              <span>{loadError}</span>
              <AiaButton
                size="small"
                variant="outlined"
                color="error"
                onClick={() => setReloadToken((value) => value + 1)}
                sx={{ textTransform: "none", minWidth: 0 }}
              >
                Retry
              </AiaButton>
            </AiaBox>
          ) : null}

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
