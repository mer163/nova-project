package main

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// These steps are deliberately fixed. A requirement can move one step forward or
// return one step for rework; this is not a general workflow engine.
var requirementSteps = []string{
	"requirement_review", "technical_review", "development", "show_case",
	"first_test", "product_walkthrough", "regression_test", "service_online",
	"launch_review", "freeze", "integration_test", "submission", "finished",
}

var requirementTransitions = func() map[string][]string {
	result := map[string][]string{"rejected": {}, "closed": {}}
	for index, state := range requirementSteps {
		if state == "finished" {
			result[state] = []string{}
			continue
		}
		next := []string{"closed"}
		if index > 0 && index < len(requirementSteps)-1 {
			next = append(next, requirementSteps[index-1])
		}
		if index < len(requirementSteps)-1 {
			next = append(next, requirementSteps[index+1])
		}
		if state == "requirement_review" || state == "technical_review" {
			next = append(next, "rejected")
		}
		result[state] = next
	}
	return result
}()

var endpointNames = []string{"client", "server", "h5", "ai_hub", "audio", "admin", "ads"}
var roleNames = []string{"pm", "version_owner", "requirement_owner", "client_developer", "server_developer", "h5_developer", "ai_hub_developer", "audio_developer", "admin_developer", "ads_developer", "ui_ux", "test", "da", "technical_review_leader"}

type ItemTransition struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	ItemID     uint      `json:"itemId" gorm:"index;not null"`
	ActorID    uint      `json:"actorId" gorm:"index;not null"`
	Action     string    `json:"action" gorm:"size:30;not null"`
	FromStatus string    `json:"fromStatus" gorm:"size:32"`
	ToStatus   string    `json:"toStatus" gorm:"size:32"`
	Track      string    `json:"track" gorm:"size:32"`
	CreatedAt  time.Time `json:"createdAt"`
}

func migrateRequirementStatuses(db *gorm.DB) error {
	// Rows written by the previous release have no development flag. Preserve
	// the endpoint lock for work that has already reached development.
	if err := db.Model(&Item{}).Where("kind = ? AND status IN ?", "requirements", []string{"in_progress", "done", "development", "show_case", "first_test", "product_walkthrough", "regression_test", "service_online", "launch_review", "freeze", "integration_test", "submission", "finished"}).Update("development_started", true).Error; err != nil {
		return err
	}
	if err := db.Model(&Item{}).Where("kind = ? AND id IN (SELECT item_id FROM item_transitions WHERE from_status = ? OR to_status = ?)", "requirements", "development", "development").Update("development_started", true).Error; err != nil {
		return err
	}
	legacy := map[string]string{"pending": "requirement_review", "in_progress": "development", "done": "finished"}
	for old, next := range legacy {
		if err := db.Model(&Item{}).Where("kind = ? AND status = ?", "requirements", old).Update("status", next).Error; err != nil {
			return err
		}
	}
	if err := db.Model(&Item{}).Where("kind = ? AND (template = '' OR template IS NULL)", "requirements").Update("template", "feature").Error; err != nil {
		return err
	}
	if err := db.Model(&Item{}).Where("kind = ? AND (risk = '' OR risk IS NULL)", "requirements").Update("risk", "none").Error; err != nil {
		return err
	}
	return db.Model(&Item{}).Where("kind = ? AND owner_id IS NULL AND assignee_id IS NOT NULL", "requirements").Update("owner_id", gorm.Expr("assignee_id")).Error
}

func validWebURL(value string) bool {
	if value == "" {
		return true
	}
	u, err := url.Parse(value)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && len(value) <= 500
}

func validDate(value string) bool {
	if value == "" {
		return true
	}
	parsed, err := time.Parse("2006-01-02", value)
	return err == nil && parsed.Format("2006-01-02") == value
}

func validateRequirement(db *gorm.DB, item *Item) error {
	if strings.TrimSpace(item.Title) == "" || utf8.RuneCountInString(item.Title) > 200 || len(item.Description) > 100000 {
		return errors.New("标题或描述无效")
	}
	if !contains([]string{"P0", "P1", "P2", "P3"}, item.Priority) {
		return errors.New("优先级无效")
	}
	if _, ok := requirementTransitions[item.Status]; !ok {
		return errors.New("需求状态无效")
	}
	if !contains([]string{"feature", "optimization", "technical"}, item.Template) {
		return errors.New("需求模板无效")
	}
	if !contains([]string{"none", "low", "medium", "high"}, item.Risk) {
		return errors.New("风险等级无效")
	}
	for _, value := range []string{item.ProductDirection, item.BusinessLine, item.PlannedVersion, item.ActualVersion} {
		if utf8.RuneCountInString(value) > 100 {
			return errors.New("字段长度超过 100 字")
		}
	}
	if !validDate(item.ExpectedAt) {
		return errors.New("预计完成日期无效")
	}
	for _, value := range []string{item.RequirementDoc, item.DesignDoc, item.TechnicalDoc, item.TestCaseDoc} {
		if !validWebURL(value) {
			return errors.New("文档链接必须是有效的 HTTP/HTTPS 地址")
		}
	}
	seenEndpoints := map[string]bool{}
	for _, endpoint := range item.Endpoints {
		if !contains(endpointNames, endpoint) || seenEndpoints[endpoint] {
			return errors.New("涉及端无效或重复")
		}
		seenEndpoints[endpoint] = true
	}
	for name, userID := range item.Roles {
		if !contains(roleNames, name) || userID == 0 {
			return errors.New("协作角色无效")
		}
		if err := requireUser(db, userID); err != nil {
			return err
		}
	}
	if item.CreatedByID != nil && item.Roles["requirement_owner"] == 0 {
		return errors.New("需求负责人必填")
	}
	for _, userID := range item.Watchers {
		if err := requireUser(db, userID); err != nil {
			return err
		}
	}
	if item.AssigneeID != nil {
		if err := requireUser(db, *item.AssigneeID); err != nil {
			return err
		}
	}
	for _, bugID := range item.RelatedBugIDs {
		var count int64
		if err := db.Model(&Item{}).Where("kind = ? AND id = ?", "bugs", bugID).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("关联 Bug #%d 不存在", bugID)
		}
	}
	return nil
}

func requireUser(db *gorm.DB, id uint) error {
	var count int64
	if err := db.Model(&User{}).Where("id = ?", id).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return fmt.Errorf("用户 #%d 不存在", id)
	}
	return nil
}

func currentRequirementOperator(item Item) *uint {
	role := "requirement_owner"
	switch item.Status {
	case "requirement_review", "show_case", "product_walkthrough", "launch_review", "submission":
		role = "pm"
	case "technical_review":
		role = "technical_review_leader"
	case "first_test", "regression_test", "integration_test":
		role = "test"
	}
	if id := item.Roles[role]; id != 0 {
		return &id
	}
	if item.OwnerID != nil {
		return item.OwnerID
	}
	if item.AssigneeID != nil {
		return item.AssigneeID
	}
	return item.CreatedByID
}

func applyRequirementInput(item *Item, input itemInput, actorID uint, create bool) {
	item.Title = strings.TrimSpace(input.Title)
	item.Description = input.Description
	item.Priority = input.Priority
	item.AssigneeID = input.AssigneeID
	item.Iteration = input.Iteration
	item.Template = input.Template
	if item.Template == "" && create {
		item.Template = "feature"
	}
	item.ProductDirection = input.ProductDirection
	item.BusinessLine = input.BusinessLine
	item.Endpoints = input.Endpoints
	item.Risk = input.Risk
	if item.Risk == "" && create {
		item.Risk = "none"
	}
	item.PlannedVersion = input.PlannedVersion
	item.ActualVersion = input.ActualVersion
	item.ExpectedAt = input.ExpectedAt
	item.RequirementDoc = input.RequirementDoc
	item.DesignDoc = input.DesignDoc
	item.TechnicalDoc = input.TechnicalDoc
	item.TestCaseDoc = input.TestCaseDoc
	item.Roles = input.Roles
	if item.Roles == nil {
		item.Roles = map[string]uint{}
	}
	if create && item.Roles["requirement_owner"] == 0 {
		item.Roles["requirement_owner"] = actorID
	}
	item.Watchers = input.Watchers
	item.RelatedBugIDs = input.RelatedBugIDs
	owner := item.Roles["requirement_owner"]
	if owner != 0 {
		item.OwnerID = &owner
	} else {
		item.OwnerID = nil
	}
	if create {
		item.CreatedByID = &actorID
	}
	updatedTracks := map[string]string{}
	for _, endpoint := range item.Endpoints {
		if item.Tracks != nil && item.Tracks[endpoint] != "" {
			updatedTracks[endpoint] = item.Tracks[endpoint]
		} else {
			updatedTracks[endpoint] = "not_started"
		}
	}
	if item.Tracks != nil && item.Tracks["test_case"] != "" {
		updatedTracks["test_case"] = item.Tracks["test_case"]
	} else {
		updatedTracks["test_case"] = "not_started"
	}
	item.Tracks = updatedTracks
	item.CurrentOperatorID = currentRequirementOperator(*item)
}

func (app *App) createRequirement(ctx *gin.Context) {
	var input itemInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		fail(ctx, 400, "invalid requirement")
		return
	}
	actor := ctx.MustGet("user").(User)
	if len(input.Endpoints) == 0 {
		fail(ctx, 400, "请至少选择一个涉及端")
		return
	}
	item := Item{Kind: "requirements", Status: "requirement_review"}
	applyRequirementInput(&item, input, actor.ID, true)
	if err := validateRequirement(app.db, &item); err != nil {
		fail(ctx, 400, err.Error())
		return
	}
	err := app.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&item).Error; err != nil {
			return err
		}
		return tx.Create(&ItemTransition{ItemID: item.ID, ActorID: actor.ID, Action: "create", ToStatus: item.Status}).Error
	})
	if err != nil {
		fail(ctx, 500, "database error")
		return
	}
	ctx.JSON(201, item)
}

func tracksReady(item Item) bool {
	for _, endpoint := range item.Endpoints {
		if item.Tracks[endpoint] != "done" && item.Tracks[endpoint] != "skipped" {
			return false
		}
	}
	return item.Tracks["test_case"] == "done" || item.Tracks["test_case"] == "skipped"
}

func (app *App) updateRequirement(ctx *gin.Context) {
	var input itemInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		fail(ctx, 400, "invalid requirement")
		return
	}
	actor := ctx.MustGet("user").(User)
	var item Item
	code := 500
	err := app.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("kind = ? AND id = ?", "requirements", ctx.Param("id")).First(&item).Error; err != nil {
			code = 404
			return errors.New("需求不存在")
		}
		previous := item.Status
		if len(item.Endpoints) > 0 && len(input.Endpoints) == 0 {
			code = 400
			return errors.New("请至少保留一个涉及端")
		}
		if item.DevelopmentStarted && !sameEndpoints(item.Endpoints, input.Endpoints) {
			code = 409
			return errors.New("开发开始后不能更改涉及端")
		}
		if input.Status == "" {
			input.Status = previous
		}
		if !validTransition("requirements", previous, input.Status) {
			code = 409
			return errors.New("状态流转不允许")
		}
		applyRequirementInput(&item, input, actor.ID, false)
		item.Status = input.Status
		if item.Status == "development" {
			item.DevelopmentStarted = true
		}
		if previous == "development" && input.Status == "show_case" && !tracksReady(item) {
			code = 409
			return errors.New("所有涉及端与用例设计须完成或跳过后才能进入 Show Case")
		}
		if err := validateRequirement(tx, &item); err != nil {
			code = 400
			return err
		}
		item.CurrentOperatorID = currentRequirementOperator(item)
		if err := tx.Save(&item).Error; err != nil {
			return err
		}
		if previous != item.Status {
			return tx.Create(&ItemTransition{ItemID: item.ID, ActorID: actor.ID, Action: "status", FromStatus: previous, ToStatus: item.Status}).Error
		}
		return nil
	})
	if err != nil {
		if code == 500 {
			fail(ctx, 500, "database error")
		} else {
			fail(ctx, code, err.Error())
		}
		return
	}
	ctx.JSON(200, item)
}

func sameEndpoints(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	seen := map[string]bool{}
	for _, value := range a {
		seen[value] = true
	}
	for _, value := range b {
		if !seen[value] {
			return false
		}
	}
	return true
}

type trackInput struct {
	Status string `json:"status"`
}

func (app *App) updateRequirementTrack(ctx *gin.Context) {
	var input trackInput
	if err := ctx.ShouldBindJSON(&input); err != nil || !contains([]string{"not_started", "in_progress", "done", "skipped"}, input.Status) {
		fail(ctx, 400, "invalid track status")
		return
	}
	actor := ctx.MustGet("user").(User)
	var item Item
	code := 500
	err := app.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("kind = ? AND id = ?", "requirements", ctx.Param("id")).First(&item).Error; err != nil {
			code = 404
			return errors.New("需求不存在")
		}
		if item.Status != "development" {
			code = 409
			return errors.New("仅开发阶段可更新并行任务")
		}
		track := ctx.Param("track")
		if track != "test_case" && !contains(item.Endpoints, track) {
			code = 400
			return errors.New("该端未列入需求")
		}
		if item.Tracks == nil {
			item.Tracks = map[string]string{}
		}
		previous := item.Tracks[track]
		if previous == input.Status {
			return nil
		}
		item.Tracks[track] = input.Status
		item.CurrentOperatorID = currentRequirementOperator(item)
		if err := tx.Save(&item).Error; err != nil {
			return err
		}
		return tx.Create(&ItemTransition{ItemID: item.ID, ActorID: actor.ID, Action: "track", FromStatus: previous, ToStatus: input.Status, Track: track}).Error
	})
	if err != nil {
		if code == 500 {
			fail(ctx, 500, "database error")
		} else {
			fail(ctx, code, err.Error())
		}
		return
	}
	ctx.JSON(200, item)
}

func (app *App) requirementHistory(ctx *gin.Context) {
	var count int64
	if err := app.db.Model(&Item{}).Where("kind = ? AND id = ?", "requirements", ctx.Param("id")).Count(&count).Error; err != nil {
		fail(ctx, 500, "database error")
		return
	}
	if count == 0 {
		fail(ctx, 404, "需求不存在")
		return
	}
	rows := make([]ItemTransition, 0)
	if err := app.db.Where("item_id = ?", ctx.Param("id")).Order("id desc").Find(&rows).Error; err != nil {
		fail(ctx, 500, "database error")
		return
	}
	ctx.JSON(200, rows)
}
