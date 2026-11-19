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
		{"requirements", "pending", "in_progress", true},
		{"requirements", "pending", "done", false},
		{"requirements", "done", "closed", true},
		{"requirements", "closed", "pending", false},
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
	if err := db.AutoMigrate(&Role{}, &User{}, &Session{}, &Item{}); err != nil {
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
	created := post("/api/requirements", map[string]any{"title": "Integration test", "priority": "P2"}, cookie)
	if created.Code != 201 {
		t.Fatalf("create item: %d %s", created.Code, created.Body.String())
	}
	var item Item
	if err := json.Unmarshal(created.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	defer db.Delete(&item)
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
	if logout := post("/api/logout", nil, cookie); logout.Code != 204 {
		t.Fatalf("logout: %d", logout.Code)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 401 {
		t.Fatalf("logged-out session accepted: %d", response.Code)
	}
}
