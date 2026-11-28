
// DABBADASH LOGIN SYSTEM

const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const togglePassword = document.getElementById("togglePassword");
const signInBtn = document.getElementById("signInBtn");
const errorMessage = document.getElementById("errorMessage");

// SHOW / HIDE PASSWORD

togglePassword.addEventListener("click", function () {

    if (passwordInput.type === "password") {
        passwordInput.type = "text";
        togglePassword.textContent = "HIDE";
    } else {
        passwordInput.type = "password";
        togglePassword.textContent = "SHOW";
    }

});

// LOGIN FORM

loginForm.addEventListener("submit", function (event) {

    event.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    errorMessage.textContent = "";

    // VALIDATION

    if (!email || !password) {
        errorMessage.textContent =
            "Please enter your email and password.";
        return;
    }

    if (!emailInput.checkValidity()) {
        errorMessage.textContent =
            "Please enter a valid email address.";
        return;
    }

    if (password.length < 4) {
        errorMessage.textContent =
            "Password must contain at least 4 characters.";
        return;
    }

    // SAVE EMAIL IF REMEMBER ME IS SELECTED

    if (document.getElementById("remember").checked) {
        localStorage.setItem("dabbaDashEmail", email);
    } else {
        localStorage.removeItem("dabbaDashEmail");
    }

    // BUTTON ANIMATION

    signInBtn.disabled = true;
    signInBtn.innerHTML = "Signing In...";

    // FRONTEND LOGIN DEMONSTRATION

    sessionStorage.setItem("dabbaDashLoggedIn", "true");

    setTimeout(function () {

        signInBtn.innerHTML = "Welcome! ✓";

        // REDIRECT TO EXISTING DASHBOARD

        window.location.href = "index.html";

    }, 900);

});

// RESTORE REMEMBERED EMAIL

const savedEmail = localStorage.getItem("dabbaDashEmail");

if (savedEmail) {
    emailInput.value = savedEmail;
    document.getElementById("remember").checked = true;
}
