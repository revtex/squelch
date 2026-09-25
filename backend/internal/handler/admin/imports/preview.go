package imports

import (
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
