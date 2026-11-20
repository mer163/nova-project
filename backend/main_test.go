package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func TestStateTransitions(t *testing.T) {
	cases := []struct {
		kind, previous, next string
		allowed              bool
	}{
		{"requirements", "requirement_review", "technical_review", true},
		{"requirements", "requirement_review", "development", false},
		{"requirements", "development", "technical_review", true},
		{"requirements", "finished", "closed", false},
		{"requirements", "closed", "requirement_review", false},
		{"bugs", "new", "assigned", true},
		{"bugs", "new", "closed", false},
		{"bugs", "verified", "fixing", true},
		{"bugs", "closed", "new", true},
	}
	for _, test := range cases {
		if actual := validTransition(test.kind, test.previous, test.next); actual != test.allowed {
			t.Errorf("%s %s -> %s: got %v", test.kind, test.previous, test.next, actual)
		}
	}
}

func TestParallelDevelopmentGate(t *testing.T) {
	item := Item{Endpoints: []string{"client", "server"}, Tracks: map[string]string{"client": "done", "server": "in_progress", "test_case": "done"}}
	if tracksReady(item) {
		t.Fatal("unfinished server work passed gate")
	}
	item.Tracks["server"] = "skipped"
	if !tracksReady(item) {
		t.Fatal("completed and skipped work should pass gate")
	}
	item.Tracks["test_case"] = "not_started"
	if tracksReady(item) {
		t.Fatal("unfinished test case passed gate")
	}
}

func TestRequirementActorPolicies(t *testing.T) {
	owner, pm, developer, tester, outsider := User{ID: 11}, User{ID: 12}, User{ID: 13}, User{ID: 14}, User{ID: 15}
	admin := User{ID: 16, Role: Role{Name: "admin"}}
	item := Item{Status: "requirement_review", OwnerID: &owner.ID, Roles: map[string]uint{
		"requirement_owner": owner.ID, "pm": pm.ID, "server_developer": developer.ID, "test": tester.ID,
	}}
	if !mayMoveRequirement(item, pm) || mayMoveRequirement(item, owner) || mayMoveRequirement(item, outsider) || !mayMoveRequirement(item, admin) {
		t.Fatal("requirement review must be advanced by PM or admin")
	}
	item.Status = "development"
	if !mayUpdateTrack(item, "server", developer) || mayUpdateTrack(item, "test_case", developer) || !mayUpdateTrack(item, "test_case", tester) || mayUpdateTrack(item, "server", outsider) || !mayUpdateTrack(item, "server", admin) {
		t.Fatal("parallel work must be limited to assigned actors")
	}
}

func TestProtectedRoutesAndOrigin(t *testing.T) {
	app := &App{}
	router := app.router()
	for _, endpoint := range []string{"/api/me", "/api/requirements", "/api/bugs", "/api/users"} {
		request := httptest.NewRequest(http.MethodGet, endpoint, nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Errorf("%s: got %d", endpoint, response.Code)
		}
	}
	request := httptest.NewRequest(http.MethodPost, "/api/register", nil)
	request.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Errorf("cross-origin request: got %d", response.Code)
	}
}

func TestStaticFallbackDoesNotMaskAPI(t *testing.T) {
	router := (&App{}).router()
	for _, test := range []struct {
		path   string
		status int
	}{{"/requirements", 200}, {"/api/missing", 404}} {
		request := httptest.NewRequest(http.MethodGet, test.path, nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != test.status {
			t.Errorf("%s: got %d", test.path, response.Code)
		}
	}
}

func TestMySQLAccountAndItemLifecycle(t *testing.T) {
	dsn := os.Getenv("MYSQL_TEST_DSN")
	if dsn == "" {
		t.Skip("MYSQL_TEST_DSN not configured")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&Role{}, &User{}, &Session{}, &Item{}, &ItemTransition{}); err != nil {
		t.Fatal(err)
	}
	app := &App{db: db}
	if err := app.seed(); err != nil {
		t.Fatal(err)
	}
	router := app.router()
	username := "test_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	password := "test-password-123"
	var user User
	defer func() { db.Where("user_id = ?", user.ID).Delete(&Session{}); db.Delete(&user) }()
	post := func(endpoint string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
		payload, _ := json.Marshal(body)
		request := httptest.NewRequest(http.MethodPost, endpoint, bytes.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			request.AddCookie(cookie)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	registered := post("/api/register", map[string]string{"username": username, "password": password}, nil)
	if registered.Code != 201 {
		t.Fatalf("register: %d %s", registered.Code, registered.Body.String())
	}
	if err := db.Preload("Role").Where("username = ?", username).First(&user).Error; err != nil {
		t.Fatal(err)
	}
	if user.Role.Name != "member" {
		t.Fatalf("registration granted %s role", user.Role.Name)
	}
	login := post("/api/login", map[string]string{"username": username, "password": password}, nil)
	if login.Code != 200 || len(login.Result().Cookies()) == 0 {
		t.Fatalf("login: %d", login.Code)
	}
	cookie := login.Result().Cookies()[0]
	denied := post("/api/roles", map[string]any{"name": "unauthorized"}, cookie)
	if denied.Code != 403 {
		t.Fatalf("member role write: %d", denied.Code)
	}
	created := post("/api/requirements", map[string]any{"title": "Integration test", "priority": "P2", "endpoints": []string{"server"}}, cookie)
	if created.Code != 201 {
		t.Fatalf("create item: %d %s", created.Code, created.Body.String())
	}
	var item Item
	if err := json.Unmarshal(created.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	defer db.Delete(&item)
	defer db.Where("item_id = ?", item.ID).Delete(&ItemTransition{})
	secondConnection, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	var persisted Item
	if err := secondConnection.First(&persisted, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.Title != item.Title {
		t.Fatal("item was not persisted")
	}
	if persisted.Status != "requirement_review" || persisted.Roles["requirement_owner"] != user.ID {
		t.Fatalf("requirement defaults missing: %+v", persisted)
	}
	put := func(endpoint string, body any) *httptest.ResponseRecorder {
		payload, _ := json.Marshal(body)
		request := httptest.NewRequest(http.MethodPut, endpoint, bytes.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	otherName := "other_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	if result := post("/api/register", map[string]string{"username": otherName, "password": password}, nil); result.Code != 201 {
		t.Fatalf("register second user: %d", result.Code)
	}
	var other User
	if err := db.Preload("Role").Where("username = ?", otherName).First(&other).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { db.Where("user_id = ?", other.ID).Delete(&Session{}); db.Delete(&other) }()
	otherLogin := post("/api/login", map[string]string{"username": otherName, "password": password}, nil)
	if otherLogin.Code != 200 || len(otherLogin.Result().Cookies()) == 0 {
		t.Fatalf("second login: %d", otherLogin.Code)
	}
	otherPut := func(endpoint string, body any) *httptest.ResponseRecorder {
		payload, _ := json.Marshal(body)
		request := httptest.NewRequest(http.MethodPut, endpoint, bytes.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(otherLogin.Result().Cookies()[0])
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	itemURL := "/api/requirements/" + strconv.Itoa(int(item.ID))
	deleteRequest := httptest.NewRequest(http.MethodDelete, itemURL, nil)
	deleteRequest.AddCookie(otherLogin.Result().Cookies()[0])
	deleteResponse := httptest.NewRecorder()
	router.ServeHTTP(deleteResponse, deleteRequest)
	if deleteResponse.Code != 403 {
		t.Fatalf("unassigned delete: %d %s", deleteResponse.Code, deleteResponse.Body.String())
	}
	if response := otherPut(itemURL, map[string]any{"status": "technical_review"}); response.Code != 403 {
		t.Fatalf("unassigned status write: %d %s", response.Code, response.Body.String())
	}
	if response := otherPut(itemURL, map[string]any{"roles": map[string]uint{"requirement_owner": other.ID}}); response.Code != 403 {
		t.Fatalf("unassigned role write: %d %s", response.Code, response.Body.String())
	}
	if response := put(itemURL, map[string]any{"description": "partial update"}); response.Code != 200 {
		t.Fatalf("partial update: %d %s", response.Code, response.Body.String())
	} else if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil || item.Title != "Integration test" || len(item.Endpoints) != 1 || item.Roles["requirement_owner"] != user.ID {
		t.Fatalf("partial update erased fields: %s", response.Body.String())
	}
	changeStatus := func(next string, expected int) {
		item.Status = next
		response := put("/api/requirements/"+strconv.Itoa(int(item.ID)), item)
		if response.Code != expected {
			t.Fatalf("status %s: %d %s", next, response.Code, response.Body.String())
		}
		if expected == 200 && json.Unmarshal(response.Body.Bytes(), &item) != nil {
			t.Fatal("invalid updated item")
		}
	}
	changeStatus("show_case", 409)
	changeStatus("technical_review", 200)
	changeStatus("development", 200)
	changeStatus("technical_review", 200)
	changedEndpoints := item
	changedEndpoints.Endpoints = []string{"client"}
	response := put("/api/requirements/"+strconv.Itoa(int(item.ID)), changedEndpoints)
	if response.Code != 409 {
		t.Fatalf("endpoint change after development rollback: %d %s", response.Code, response.Body.String())
	}
	changeStatus("development", 200)
	changeStatus("show_case", 409)
	if response := otherPut(itemURL+"/tracks/server", map[string]string{"status": "done"}); response.Code != 403 {
		t.Fatalf("unassigned track write: %d %s", response.Code, response.Body.String())
	}
	if response := put(itemURL+"/tracks/server", map[string]string{"status": "skipped"}); response.Code != 403 {
		t.Fatalf("non-PM track skip: %d %s", response.Code, response.Body.String())
	}
	for _, track := range []string{"server", "test_case"} {
		response := put("/api/requirements/"+strconv.Itoa(int(item.ID))+"/tracks/"+track, map[string]string{"status": "done"})
		if response.Code != 200 {
			t.Fatalf("track %s: %d %s", track, response.Code, response.Body.String())
		}
		if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
			t.Fatal(err)
		}
	}
	pmRole := put(itemURL, map[string]any{"roles": map[string]uint{"requirement_owner": user.ID, "pm": user.ID}})
	if pmRole.Code != 200 || json.Unmarshal(pmRole.Body.Bytes(), &item) != nil {
		t.Fatalf("assign PM: %d %s", pmRole.Code, pmRole.Body.String())
	}
	if response := put(itemURL+"/tracks/server", map[string]string{"status": "skipped"}); response.Code != 400 {
		t.Fatalf("skip without reason: %d %s", response.Code, response.Body.String())
	}
	for _, update := range []map[string]string{{"status": "skipped", "reason": "本轮取消服务端工作"}, {"status": "done"}} {
		response := put(itemURL+"/tracks/server", update)
		if response.Code != 200 {
			t.Fatalf("PM track update: %d %s", response.Code, response.Body.String())
		}
		if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
			t.Fatal(err)
		}
	}
	changeStatus("show_case", 200)
	historyRequest := httptest.NewRequest(http.MethodGet, "/api/requirements/"+strconv.Itoa(int(item.ID))+"/history", nil)
	historyRequest.AddCookie(cookie)
	historyResponse := httptest.NewRecorder()
	router.ServeHTTP(historyResponse, historyRequest)
	var history []ItemTransition
	if historyResponse.Code != 200 || json.Unmarshal(historyResponse.Body.Bytes(), &history) != nil || len(history) != 10 {
		t.Fatalf("history: %d %s", historyResponse.Code, historyResponse.Body.String())
	}
	if history[1].Reason != "" || history[2].Reason != "本轮取消服务端工作" {
		t.Fatalf("skip reason missing from history: %+v", history[:3])
	}
	legacy := Item{Kind: "requirements", Title: "Legacy", Priority: "P2", Status: "pending", AssigneeID: &user.ID}
	legacyDevelopment := Item{Kind: "requirements", Title: "Legacy development", Priority: "P2", Status: "in_progress", AssigneeID: &user.ID}
	rolledBack := Item{Kind: "requirements", Title: "Rolled back", Priority: "P2", Status: "technical_review", AssigneeID: &user.ID, Endpoints: []string{"server"}}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&legacyDevelopment).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&rolledBack).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&ItemTransition{ItemID: rolledBack.ID, ActorID: user.ID, Action: "status", FromStatus: "development", ToStatus: "technical_review"}).Error; err != nil {
		t.Fatal(err)
	}
	defer db.Delete(&legacy)
	defer db.Delete(&legacyDevelopment)
	defer db.Delete(&rolledBack)
	defer db.Where("item_id = ?", rolledBack.ID).Delete(&ItemTransition{})
	if err := migrateRequirementStatuses(db); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&legacy, legacy.ID).Error; err != nil {
		t.Fatal(err)
	}
	if legacy.Status != "requirement_review" || legacy.Template != "feature" || legacy.OwnerID == nil || *legacy.OwnerID != user.ID {
		t.Fatalf("legacy requirement not migrated: %+v", legacy)
	}
	if err := db.First(&legacyDevelopment, legacyDevelopment.ID).Error; err != nil {
		t.Fatal(err)
	}
	if legacyDevelopment.Status != "development" || !legacyDevelopment.DevelopmentStarted {
		t.Fatalf("legacy development endpoint lock not migrated: %+v", legacyDevelopment)
	}
	if err := db.First(&rolledBack, rolledBack.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !rolledBack.DevelopmentStarted {
		t.Fatal("previously rolled back requirement lost endpoint lock")
	}
	if logout := post("/api/logout", nil, cookie); logout.Code != 204 {
		t.Fatalf("logout: %d", logout.Code)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	request.AddCookie(cookie)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 401 {
		t.Fatalf("logged-out session accepted: %d", response.Code)
	}
}
