package main

import (
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

//go:embed static
var staticFiles embed.FS

type User struct {
	ID           uint   `json:"id" gorm:"primaryKey"`
	Username     string `json:"username" gorm:"uniqueIndex;size:100;not null"`
	PasswordHash string `json:"-" gorm:"size:255;not null"`
	RoleID       uint   `json:"roleId" gorm:"not null;index"`
	Role         Role   `json:"role"`
}

type Role struct {
	ID          uint   `json:"id" gorm:"primaryKey"`
	Name        string `json:"name" gorm:"uniqueIndex;size:100;not null"`
	Permissions string `json:"-" gorm:"type:text;not null"`
}

type Session struct {
	ID        uint      `gorm:"primaryKey"`
	TokenHash string    `gorm:"uniqueIndex;size:64;not null"`
	UserID    uint      `gorm:"index;not null"`
	ExpiresAt time.Time `gorm:"index;not null"`
}

type Item struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	Kind        string    `json:"kind" gorm:"index;size:16;not null"`
	Title       string    `json:"title" gorm:"size:200;not null"`
	Description string    `json:"description" gorm:"type:text"`
	Priority    string    `json:"priority" gorm:"size:8"`
	Severity    string    `json:"severity" gorm:"size:20"`
	Status      string    `json:"status" gorm:"index;size:32;not null"`
	AssigneeID  *uint     `json:"assigneeId" gorm:"index"`
	Iteration   string    `json:"iteration" gorm:"size:100"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type App struct {
	db           *gorm.DB
	secureCookie bool
}

var allPermissions = []string{"items:read", "items:create", "items:update", "items:delete", "users:read", "users:write", "roles:read", "roles:write"}
var memberPermissions = "items:read,items:create,items:update,items:delete"
var errLastAdmin = errors.New("cannot remove the last administrator")

func main() {
	dsn := os.Getenv("MYSQL_DSN")
	if dsn == "" {
		panic("MYSQL_DSN is required")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		panic(err)
	}
	if err := db.AutoMigrate(&Role{}, &User{}, &Session{}, &Item{}); err != nil {
		panic(err)
	}
	app := &App{db: db, secureCookie: os.Getenv("COOKIE_SECURE") == "true"}
	if err := app.seed(); err != nil {
		panic(err)
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	if err := app.router().Run(":" + port); err != nil {
		panic(err)
	}
}

func (app *App) seed() error {
	for _, role := range []Role{{Name: "admin", Permissions: strings.Join(allPermissions, ",")}, {Name: "member", Permissions: memberPermissions}} {
		var existing Role
		if err := app.db.Where("name = ?", role.Name).First(&existing).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			if err := app.db.Create(&role).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
	}
	username, password := os.Getenv("ADMIN_USERNAME"), os.Getenv("ADMIN_PASSWORD")
	if username == "" || password == "" {
		return nil
	}
	var role Role
	if err := app.db.Where("name = ?", "admin").First(&role).Error; err != nil {
		return err
	}
	var count int64
	if err := app.db.Model(&User{}).Where("role_id = ?", role.ID).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if len(password) < 12 {
		return errors.New("ADMIN_PASSWORD must have at least 12 characters")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return app.db.Create(&User{Username: username, PasswordHash: string(hash), RoleID: role.ID}).Error
}

func randomToken() (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

func hashToken(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func fail(ctx *gin.Context, status int, message string) {
	ctx.AbortWithStatusJSON(status, gin.H{"error": message})
}

func (app *App) csrf() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		if ctx.Request.Method != http.MethodGet && ctx.Request.Method != http.MethodHead && ctx.Request.Method != http.MethodOptions {
			origin := ctx.GetHeader("Origin")
			if origin != "" && origin != "http://"+ctx.Request.Host && origin != "https://"+ctx.Request.Host {
				fail(ctx, 403, "invalid origin")
				return
			}
			if ctx.GetHeader("Sec-Fetch-Site") == "cross-site" {
				fail(ctx, 403, "cross-site request denied")
				return
			}
		}
		ctx.Next()
	}
}

func (app *App) auth(permission string) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		token, err := ctx.Cookie("nova_session")
		if err != nil {
			fail(ctx, 401, "login required")
			return
		}
		var session Session
		if err := app.db.Where("token_hash = ? AND expires_at > ?", hashToken(token), time.Now()).First(&session).Error; err != nil {
			fail(ctx, 401, "session expired")
			return
		}
		var user User
		if err := app.db.Preload("Role").First(&user, session.UserID).Error; err != nil {
			fail(ctx, 401, "user unavailable")
			return
		}
		if permission != "" && !strings.Contains(","+user.Role.Permissions+",", ","+permission+",") {
			fail(ctx, 403, "permission denied")
			return
		}
		ctx.Set("user", user)
		ctx.Next()
	}
}

func (app *App) router() *gin.Engine {
	router := gin.Default()
	router.Use(app.csrf())
	api := router.Group("/api")
	api.POST("/register", app.register)
	api.POST("/login", app.login)
	api.POST("/logout", app.auth(""), app.logout)
	api.GET("/me", app.auth(""), func(ctx *gin.Context) { ctx.JSON(200, ctx.MustGet("user")) })
	api.GET("/users", app.auth("items:read"), app.listUsers)
	api.POST("/users", app.auth("users:write"), app.createUser)
	api.PUT("/users/:id", app.auth("users:write"), app.updateUser)
	api.GET("/roles", app.auth("roles:read"), app.listRoles)
	api.POST("/roles", app.auth("roles:write"), app.createRole)
	api.PUT("/roles/:id", app.auth("roles:write"), app.updateRole)
	for _, kind := range []string{"requirements", "bugs"} {
		group := api.Group("/" + kind)
		group.GET("", app.auth("items:read"), app.listItems(kind))
		group.GET("/:id", app.auth("items:read"), app.getItem(kind))
		group.POST("", app.auth("items:create"), app.createItem(kind))
		group.PUT("/:id", app.auth("items:update"), app.updateItem(kind))
		group.DELETE("/:id", app.auth("items:delete"), app.deleteItem(kind))
	}
	assets, _ := fs.Sub(staticFiles, "static")
	router.NoRoute(func(ctx *gin.Context) {
		if strings.HasPrefix(ctx.Request.URL.Path, "/api/") {
			fail(ctx, 404, "not found")
			return
		}
		name := strings.TrimPrefix(path.Clean(ctx.Request.URL.Path), "/")
		if name == "." {
			name = "index.html"
		}
		if _, err := fs.Stat(assets, name); err != nil {
			name = "index.html"
		}
		if name == "index.html" {
			index, err := fs.ReadFile(assets, name)
			if err != nil {
				fail(ctx, 500, "frontend unavailable")
				return
			}
			ctx.Data(200, "text/html; charset=utf-8", index)
			return
		}
		ctx.FileFromFS(name, http.FS(assets))
	})
	return router
}

type credentials struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func (app *App) register(ctx *gin.Context) {
	var input credentials
	if err := ctx.ShouldBindJSON(&input); err != nil || len(input.Username) < 3 || len(input.Password) < 12 {
		fail(ctx, 400, "username or password invalid")
		return
	}
	var role Role
	if err := app.db.Where("name = ?", "member").First(&role).Error; err != nil {
		fail(ctx, 500, "role unavailable")
		return
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		fail(ctx, 500, "password error")
		return
	}
	user := User{Username: input.Username, PasswordHash: string(passwordHash), RoleID: role.ID}
	if err := app.db.Create(&user).Error; err != nil {
		fail(ctx, 409, "username already exists")
		return
	}
	ctx.JSON(201, gin.H{"id": user.ID})
}

func (app *App) login(ctx *gin.Context) {
	var input credentials
	if err := ctx.ShouldBindJSON(&input); err != nil {
		fail(ctx, 400, "invalid credentials")
		return
	}
	var user User
	if err := app.db.Preload("Role").Where("username = ?", input.Username).First(&user).Error; err != nil || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)) != nil {
		fail(ctx, 401, "invalid credentials")
		return
	}
	token, err := randomToken()
	if err != nil {
		fail(ctx, 500, "session error")
		return
	}
	session := Session{TokenHash: hashToken(token), UserID: user.ID, ExpiresAt: time.Now().Add(7 * 24 * time.Hour)}
	if err := app.db.Create(&session).Error; err != nil {
		fail(ctx, 500, "session error")
		return
	}
	ctx.SetSameSite(http.SameSiteLaxMode)
	ctx.SetCookie("nova_session", token, 7*24*3600, "/", "", app.secureCookie, true)
	ctx.JSON(200, user)
}

func (app *App) logout(ctx *gin.Context) {
	token, _ := ctx.Cookie("nova_session")
	app.db.Where("token_hash = ?", hashToken(token)).Delete(&Session{})
	ctx.SetSameSite(http.SameSiteLaxMode)
	ctx.SetCookie("nova_session", "", -1, "/", "", app.secureCookie, true)
	ctx.Status(204)
}

func (app *App) listUsers(ctx *gin.Context) {
	users := make([]User, 0)
	if err := app.db.Preload("Role").Order("id").Find(&users).Error; err != nil {
		fail(ctx, 500, "database error")
		return
	}
	ctx.JSON(200, users)
}

type userInput struct {
	Username string `json:"username"`
	Password string `json:"password"`
	RoleID   uint   `json:"roleId"`
}

func (app *App) saveUser(ctx *gin.Context, create bool) {
	var input userInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		fail(ctx, 400, "invalid user")
		return
	}
	var user User
	if create {
		if len(input.Username) < 3 || len(input.Password) < 12 || input.RoleID == 0 {
			fail(ctx, 400, "invalid user")
			return
		}
	} else if app.db.First(&user, ctx.Param("id")).Error != nil {
		fail(ctx, 404, "user not found")
		return
	}
	previousRoleID := user.RoleID
	if input.Username != "" && len(input.Username) < 3 {
		fail(ctx, 400, "invalid username")
		return
	}
	if input.Username != "" {
		user.Username = input.Username
	}
	if input.RoleID != 0 {
		var role Role
		if app.db.First(&role, input.RoleID).Error != nil {
			fail(ctx, 400, "invalid role")
			return
		}
		user.RoleID = input.RoleID
	}
	if input.Password != "" {
		if len(input.Password) < 12 {
			fail(ctx, 400, "password too short")
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
		if err != nil {
			fail(ctx, 500, "password error")
			return
		}
		user.PasswordHash = string(hash)
	}
	save := func(tx *gorm.DB) error { return tx.Save(&user).Error }
	var saveError error
	if !create && previousRoleID != user.RoleID {
		saveError = app.db.Transaction(func(tx *gorm.DB) error {
			var adminRole Role
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("name = ?", "admin").First(&adminRole).Error; err != nil {
				return err
			}
			if previousRoleID == adminRole.ID {
				var count int64
				if err := tx.Model(&User{}).Where("role_id = ?", adminRole.ID).Count(&count).Error; err != nil {
					return err
				}
				if count <= 1 {
					return errLastAdmin
				}
			}
			return save(tx)
		})
	} else {
		saveError = save(app.db)
	}
	if saveError != nil {
		if errors.Is(saveError, errLastAdmin) {
			fail(ctx, 409, saveError.Error())
			return
		}
		fail(ctx, 409, "user conflict")
		return
	}
	app.db.Preload("Role").First(&user, user.ID)
	ctx.JSON(200, user)
}

func (app *App) createUser(ctx *gin.Context) { app.saveUser(ctx, true) }
func (app *App) updateUser(ctx *gin.Context) { app.saveUser(ctx, false) }

func (app *App) listRoles(ctx *gin.Context) {
	var roles []Role
	if err := app.db.Order("id").Find(&roles).Error; err != nil {
		fail(ctx, 500, "database error")
		return
	}
	result := make([]gin.H, 0, len(roles))
	for _, role := range roles {
		result = append(result, gin.H{"id": role.ID, "name": role.Name, "permissions": strings.Split(role.Permissions, ",")})
	}
	ctx.JSON(200, result)
}

type roleInput struct {
	Name        string   `json:"name"`
	Permissions []string `json:"permissions"`
}

func (app *App) saveRole(ctx *gin.Context, create bool) {
	var input roleInput
	if err := ctx.ShouldBindJSON(&input); err != nil || len(input.Name) < 2 {
		fail(ctx, 400, "invalid role")
		return
	}
	allowed := make(map[string]bool)
	for _, permission := range allPermissions {
		allowed[permission] = true
	}
	for _, permission := range input.Permissions {
		if !allowed[permission] {
			fail(ctx, 400, "invalid permission")
			return
		}
	}
	var role Role
	if !create && app.db.First(&role, ctx.Param("id")).Error != nil {
		fail(ctx, 404, "role not found")
		return
	}
	if role.Name == "admin" || role.Name == "member" {
		fail(ctx, 403, "built-in role is immutable")
		return
	}
	role.Name = input.Name
	role.Permissions = strings.Join(input.Permissions, ",")
	if err := app.db.Save(&role).Error; err != nil {
		fail(ctx, 409, "role conflict")
		return
	}
	ctx.JSON(200, gin.H{"id": role.ID, "name": role.Name, "permissions": input.Permissions})
}

func (app *App) createRole(ctx *gin.Context) { app.saveRole(ctx, true) }
func (app *App) updateRole(ctx *gin.Context) { app.saveRole(ctx, false) }

var transitions = map[string]map[string][]string{
	"requirements": {"pending": {"in_progress", "rejected", "closed"}, "in_progress": {"done", "pending", "closed"}, "done": {"closed", "in_progress"}, "rejected": {}, "closed": {}},
	"bugs":         {"new": {"assigned"}, "assigned": {"fixing", "new"}, "fixing": {"verified", "assigned"}, "verified": {"closed", "fixing"}, "closed": {"new"}},
}

func validTransition(kind, previous, next string) bool {
	if previous == next {
		return true
	}
	for _, candidate := range transitions[kind][previous] {
		if candidate == next {
			return true
		}
	}
	return false
}

type itemInput struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Priority    string `json:"priority"`
	Severity    string `json:"severity"`
	Status      string `json:"status"`
	AssigneeID  *uint  `json:"assigneeId"`
	Iteration   string `json:"iteration"`
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func (app *App) validateItem(ctx *gin.Context, kind string, item *Item) bool {
	if strings.TrimSpace(item.Title) == "" || len(item.Title) > 200 || len(item.Iteration) > 100 {
		fail(ctx, 400, "invalid title or iteration")
		return false
	}
	if kind == "requirements" && !contains([]string{"P0", "P1", "P2", "P3"}, item.Priority) {
		fail(ctx, 400, "invalid priority")
		return false
	}
	if kind == "bugs" && !contains([]string{"fatal", "critical", "normal", "minor"}, item.Severity) {
		fail(ctx, 400, "invalid severity")
		return false
	}
	if _, ok := transitions[kind][item.Status]; !ok {
		fail(ctx, 400, "invalid status")
		return false
	}
	if kind == "bugs" && item.Status == "assigned" && item.AssigneeID == nil {
		fail(ctx, 400, "assignee required")
		return false
	}
	if item.AssigneeID != nil {
		var count int64
		app.db.Model(&User{}).Where("id = ?", *item.AssigneeID).Count(&count)
		if count == 0 {
			fail(ctx, 400, "assignee not found")
			return false
		}
	}
	return true
}

func (app *App) listItems(kind string) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		query := app.db.Model(&Item{}).Where("kind = ?", kind)
		if status := ctx.Query("status"); status != "" {
			query = query.Where("status = ?", status)
		}
		if assignee := ctx.Query("assigneeId"); assignee != "" {
			query = query.Where("assignee_id = ?", assignee)
		}
		if kind == "requirements" {
			if priority := ctx.Query("priority"); priority != "" {
				query = query.Where("priority = ?", priority)
			}
		} else {
			if severity := ctx.Query("severity"); severity != "" {
				query = query.Where("severity = ?", severity)
			}
		}
		items := make([]Item, 0)
		if err := query.Order("updated_at desc").Find(&items).Error; err != nil {
			fail(ctx, 500, "database error")
			return
		}
		ctx.JSON(200, items)
	}
}

func (app *App) getItem(kind string) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		var item Item
		if app.db.Where("kind = ? AND id = ?", kind, ctx.Param("id")).First(&item).Error != nil {
			fail(ctx, 404, "item not found")
			return
		}
		ctx.JSON(200, item)
	}
}

func (app *App) createItem(kind string) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		var input itemInput
		if err := ctx.ShouldBindJSON(&input); err != nil {
			fail(ctx, 400, "invalid item")
			return
		}
		item := Item{Kind: kind, Title: input.Title, Description: input.Description, Priority: input.Priority, Severity: input.Severity, AssigneeID: input.AssigneeID, Iteration: input.Iteration}
		if kind == "requirements" {
			item.Status = "pending"
		} else {
			item.Status = "new"
		}
		if !app.validateItem(ctx, kind, &item) {
			return
		}
		if err := app.db.Create(&item).Error; err != nil {
			fail(ctx, 500, "database error")
			return
		}
		ctx.JSON(201, item)
	}
}

func (app *App) updateItem(kind string) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		var item Item
		if app.db.Where("kind = ? AND id = ?", kind, ctx.Param("id")).First(&item).Error != nil {
			fail(ctx, 404, "item not found")
			return
		}
		var input itemInput
		if err := ctx.ShouldBindJSON(&input); err != nil {
			fail(ctx, 400, "invalid item")
			return
		}
		previous := item.Status
		if input.Status == "" {
			input.Status = previous
		}
		if !validTransition(kind, previous, input.Status) {
			fail(ctx, 409, "invalid status transition")
			return
		}
		item.Title, item.Description, item.Priority, item.Severity = input.Title, input.Description, input.Priority, input.Severity
		item.Status, item.AssigneeID, item.Iteration = input.Status, input.AssigneeID, input.Iteration
		if !app.validateItem(ctx, kind, &item) {
			return
		}
		if err := app.db.Save(&item).Error; err != nil {
			fail(ctx, 500, "database error")
			return
		}
		ctx.JSON(200, item)
	}
}

func (app *App) deleteItem(kind string) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		result := app.db.Where("kind = ? AND id = ?", kind, ctx.Param("id")).Delete(&Item{})
		if result.Error != nil {
			fail(ctx, 500, "database error")
			return
		}
		if result.RowsAffected == 0 {
			fail(ctx, 404, "item not found")
			return
		}
		ctx.Status(204)
	}
}
