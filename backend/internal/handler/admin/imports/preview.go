package imports

import (
	"context"
	"io"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/admin"
	"github.com/revtex/squelch/internal/handler/shared"
)

// PreviewTalkgroups handles POST /api/v1/admin/import/talkgroups/preview.
//
//	@Summary      Preview a talkgroup CSV import
//	@Description  Reads a Squelch, rdio-scanner or RadioReference talkgroup CSV and reports, row by row, whether each talkgroup is new, unchanged or would change on the given system, with the current and new value of every field that differs. Nothing is written; apply the rows with the talkgroups.import admin operation.
//	@Tags         v1-Admin
//	@Accept       multipart/form-data
//	@Produce      json
//	@Param        system_id  formData  int   true  "System to import into"
//	@Param        file       formData  file  true  "CSV file"
//	@Success      200  {object}  admin.TalkgroupImportPreview
//	@Failure      400  {object}  shared.ErrorResponse
//	@Security     BearerAuth
//	@Router       /v1/admin/import/talkgroups/preview [post]
func (h *Handler) PreviewTalkgroups(c *gin.Context) {
	ctx := c.Request.Context()
	systemID, err := strconv.ParseInt(c.PostForm("system_id"), 10, 64)
	if err != nil || systemID <= 0 {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed, "system_id is required", nil)
		return
	}
	if _, err := h.queries.GetSystem(ctx, systemID); err != nil {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed, "system not found", nil)
		return
	}
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed, "file is required", nil)
		return
	}
	defer file.Close()

	format, rows, problems, err := admin.ParseTalkgroupCSV(io.LimitReader(file, 5<<20))
	if err != nil {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed, err.Error(), nil)
		return
	}
	preview, err := admin.PreviewTalkgroupImport(ctx, h.queries, systemID, format, rows, problems)
	if err != nil {
		shared.WriteAPIError(c, http.StatusInternalServerError, shared.CodeInternalError, "could not compare the file with the system", nil)
		return
	}
	c.JSON(http.StatusOK, preview)
}

// PreviewUnits handles POST /api/v1/admin/import/units/preview.
//
//	@Summary      Preview a unit CSV import
//	@Description  Reads a unit CSV (unit_id, label, order; a Squelch export with a system column is accepted) and reports, row by row, whether each unit is new, unchanged or would change on the given system. Nothing is written; apply the rows with the units.import admin operation.
//	@Tags         v1-Admin
//	@Accept       multipart/form-data
//	@Produce      json
//	@Param        system_id  formData  int   true  "System to import into"
//	@Param        file       formData  file  true  "CSV file"
//	@Success      200  {object}  admin.UnitImportPreview
//	@Failure      400  {object}  shared.ErrorResponse
//	@Security     BearerAuth
//	@Router       /v1/admin/import/units/preview [post]
func (h *Handler) PreviewUnits(c *gin.Context) {
	ctx := c.Request.Context()
	systemID, err := strconv.ParseInt(c.PostForm("system_id"), 10, 64)
	if err != nil || systemID <= 0 {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed, "system_id is required", nil)
		return
	}
	if _, err := h.queries.GetSystem(ctx, systemID); err != nil {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed, "system not found", nil)
		return
	}
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed, "file is required", nil)
		return
	}
	defer file.Close()

	rows, problems, err := admin.ParseUnitCSV(io.LimitReader(file, 5<<20))
	if err != nil {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed, err.Error(), nil)
		return
	}
	preview, err := admin.PreviewUnitImport(ctx, h.queries, systemID, rows, problems)
	if err != nil {
		shared.WriteAPIError(c, http.StatusInternalServerError, shared.CodeInternalError, "could not compare the file with the system", nil)
		return
	}
	c.JSON(http.StatusOK, preview)
}

// PreviewGroups handles POST /api/v1/admin/import/groups/preview.
//
//	@Summary      Preview a group CSV import
//	@Description  Reads one label per row (a "label" header is optional) and reports which groups are new and which already exist. Nothing is written; apply with the groups.import admin operation.
//	@Tags         v1-Admin
//	@Accept       multipart/form-data
//	@Produce      json
//	@Param        file  formData  file  true  "CSV file"
//	@Success      200  {object}  admin.LabelImportPreview
//	@Failure      400  {object}  shared.ErrorResponse
//	@Security     BearerAuth
//	@Router       /v1/admin/import/groups/preview [post]
func (h *Handler) PreviewGroups(c *gin.Context) {
	h.previewLabels(c, func(ctx context.Context) ([]string, error) {
		gs, err := h.queries.ListGroups(ctx)
		if err != nil {
			return nil, err
		}
		out := make([]string, len(gs))
		for i, g := range gs {
			out[i] = g.Label
		}
		return out, nil
	})
}

// PreviewTags handles POST /api/v1/admin/import/tags/preview.
//
//	@Summary      Preview a tag CSV import
//	@Description  Reads one label per row (a "label" header is optional) and reports which tags are new and which already exist. Nothing is written; apply with the tags.import admin operation.
//	@Tags         v1-Admin
//	@Accept       multipart/form-data
//	@Produce      json
//	@Param        file  formData  file  true  "CSV file"
//	@Success      200  {object}  admin.LabelImportPreview
//	@Failure      400  {object}  shared.ErrorResponse
//	@Security     BearerAuth
//	@Router       /v1/admin/import/tags/preview [post]
func (h *Handler) PreviewTags(c *gin.Context) {
	h.previewLabels(c, func(ctx context.Context) ([]string, error) {
		ts, err := h.queries.ListTags(ctx)
		if err != nil {
			return nil, err
		}
		out := make([]string, len(ts))
		for i, t := range ts {
			out[i] = t.Label
		}
		return out, nil
	})
}

func (h *Handler) previewLabels(c *gin.Context, existing func(context.Context) ([]string, error)) {
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed, "file is required", nil)
		return
	}
	defer file.Close()
	rows, problems, err := admin.ParseLabelCSV(io.LimitReader(file, 5<<20))
	if err != nil {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed, err.Error(), nil)
		return
	}
	have, err := existing(c.Request.Context())
	if err != nil {
		shared.WriteAPIError(c, http.StatusInternalServerError, shared.CodeInternalError, "could not compare the file with what exists", nil)
		return
	}
	c.JSON(http.StatusOK, admin.PreviewLabelImport(have, rows, problems))
}
