// Your Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyAElv-6l5kmGSwoaCLpJVMOqpP7cghSCp0",
    authDomain: "yap4yap-d8354.firebaseapp.com",
    // I've added your databaseURL based on your project ID
    databaseURL: "https://yap4yap-d8354-default-rtdb.firebaseio.com", 
    projectId: "yap4yap-d8354",
    storageBucket: "yap4yap-d8354.firebasestorage.app",
    messagingSenderId: "561112125395",
    appId: "1:561112125395:web:bce7e8a30e6dac21ca2926"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.database();

// --- Constants ---
const ADMIN_USERNAME = 'omarelhaq'; // Your Feature 5.1 (Updated)
const STARTING_POINTS = 60; // Your Feature 1.3
const TASK_REWARDS = { // Your Feature 2.2
    like: 10,
    comment: 20,
    both: 30
};
const TASK_TIMES = { // Your Feature 3.3
    like: 4,
    comment: 7,
    both: 11
};
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

// --- Global State ---
let currentUser = null; // Will hold all user data (auth + db data)
let allPosts = {}; // Local cache of all posts
let myPosts = {}; // Local cache of user's own posts
let allUsers = {};
let activeTaskTimers = {}; // For hidden timers
let inactivityTimer = null; // For inactivity filter

// --- DOM Elements ---
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const authError = document.getElementById('auth-error');
const postError = document.getElementById('post-error');
const authFormTitle = document.getElementById('form-title');
const authEmailInput = document.getElementById('auth-email');
const authUsernameInput = document.getElementById('auth-username');
const authPasswordInput = document.getElementById('auth-password');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const toggleFormLink = document.getElementById('toggle-form-link');
const logoutBtn = document.getElementById('logout-btn');
const userDisplay = document.getElementById('user-display');
const pointsDisplay = document.getElementById('points-display');
const createPostForm = document.getElementById('create-post-form');
const createPostBtn = document.getElementById('create-post-btn');
const postUrlInput = document.getElementById('post-url');
const myPostsList = document.getElementById('my-posts-list');
const availableTasksList = document.getElementById('available-tasks-list');
const statPoints = document.getElementById('stat-points');
const statTasks = document.getElementById('stat-tasks');
const statPosts = document.getElementById('stat-posts');

// New inactivity elements
const inactivityOverlay = document.getElementById('inactivity-overlay');
const reconnectBtn = document.getElementById('reconnect-btn');


// --- Auth UI Toggle ---
let isRegisterMode = false;

// NOTE: Check if elements exist before adding listeners,
// because app.js is now loaded on login.html, but not index.html
if (toggleFormLink) {
    toggleFormLink.addEventListener('click', (e) => {
        e.preventDefault();
        isRegisterMode = !isRegisterMode;
        
        authFormTitle.innerText = isRegisterMode ? 'Register' : 'Login';
        authSubmitBtn.innerText = isRegisterMode ? 'Register' : 'Login';
        authEmailInput.style.display = isRegisterMode ? 'block' : 'none';
        authUsernameInput.placeholder = isRegisterMode ? 'Choose a Username' : 'Username';
        authError.style.display = 'none';
    });
}

// --- Phase 1: Authentication Logic ---

// Handle Register / Login
if (authSubmitBtn) {
    authSubmitBtn.addEventListener('click', async () => {
        const email = authEmailInput.value;
        const password = authPasswordInput.value;
        const username = authUsernameInput.value;

        authError.style.display = 'none';
        authSubmitBtn.disabled = true;
        authSubmitBtn.innerText = 'Please wait...';

        try {
            if (isRegisterMode) {
                // --- Register Logic (Feature 1.1) ---
                if (!username || !email || !password) {
                    throw new Error('All fields are required for registration.');
                }
                const userCredential = await auth.createUserWithEmailAndPassword(email, password);
                const user = userCredential.user;

                // --- Create user profile in Realtime Database (Feature 1.5) ---
                const isAdmin = username.toLowerCase() === ADMIN_USERNAME; // Feature 1.4
                const newUserProfile = {
                    uid: user.uid,
                    username: username,
                    email: user.email,
                    // --- THIS IS THE FIX ---
                    // Store a normal number. The "isAdmin" flag will handle the rest.
                    points: STARTING_POINTS, 
                    // --- END FIX ---
                    isAdmin: isAdmin, // Feature 5.1
                    tasksCompleted: 0,
                    postsCreated: 0,
                    completedTasks: {} // Store completed task IDs here
                };

                // Set the user data in the database
                // This is the line that was failing
                await db.ref('users/' + user.uid).set(newUserProfile);

            } else {
                // --- Login Logic (Feature 1.2) ---
                if (!username || !password) {
                    throw new Error('Username and Password are required.');
                }
                
                const usersSnapshot = await db.ref('users').orderByChild('username').equalTo(username).once('value');
                if (!usersSnapshot.exists()) {
                    throw new Error('Username not found.');
                }
                
                const userData = Object.values(usersSnapshot.val())[0];
                await auth.signInWithEmailAndPassword(userData.email, password);
            }
        } catch (error) {
            authError.innerText = error.message;
            authError.style.display = 'block';
        } finally {
            authSubmitBtn.disabled = false;
            authSubmitBtn.innerText = isRegisterMode ? 'Register' : 'Login';
        }
    });
}

// --- Auth State Listener ---
auth.onAuthStateChanged(user => {
    
    // Only run auth UI logic if we are on the login page
    if (authContainer) {
        if (user) {
            // User is logged in
            listenToUserData(user.uid); 
            listenToAllPosts(); 
            listenToAllUsers();
            
            authContainer.style.display = 'none';
            appContainer.style.display = 'block';

            // --- ADD THIS LINE ---
            setupInactivityListeners(); // Start tracking activity

        } else {
            // User is logged out

            // --- ADD THESE LINES ---
            clearInactivityListeners(); // Stop tracking activity
            if (inactivityOverlay) { // Hide modal if it's open
                 inactivityOverlay.style.display = 'none';
            }
            // --- END ADD ---
            
            if (currentUser) {
                // Stop listening to the specific user's data
                db.ref('users/' + currentUser.uid).off(); 
            }
            db.ref('posts').off(); // Stop listening to all posts
            db.ref('users').off(); // Stop listening to all users

            currentUser = null;
            authContainer.style.display = 'flex';
            appContainer.style.display = 'none';
        }
    }
});

// --- Logout ---
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        auth.signOut().then(() => {
            // Redirect to login page after sign out
            window.location.href = 'login.html';
        });
    });
}

// --- Phase 2: Realtime Database Listeners (Feature 7) ---

function listenToUserData(userId) {
    const userRef = db.ref('users/' + userId);
    userRef.on('value', (snapshot) => {
        currentUser = snapshot.val();
        if (currentUser) {
            updateUIWithUserData();
            renderAllTasks(); 
        }
    });
}

function listenToAllPosts() {
    const postsRef = db.ref('posts');
    postsRef.on('value', (snapshot) => {
        allPosts = snapshot.val() || {};
        renderAllTasks(); 
    });
}

function listenToAllUsers() {
    const usersRef = db.ref('users');
    usersRef.on('value', (snapshot) => {
        allUsers = snapshot.val() || {};
        renderAllTasks();
    });
}

// --- Phase 3: Update UI & Render Lists ---

function updateUIWithUserData() {
    if (!currentUser || !userDisplay) return; // Check if elements exist
    
    const pointsStr = currentUser.isAdmin ? '∞' : currentUser.points;
    
    userDisplay.innerText = currentUser.username;
    pointsDisplay.innerText = `${pointsStr} points`;
    statPoints.innerText = pointsStr;
    statTasks.innerText = currentUser.tasksCompleted || 0;
    
    let myPostCount = 0;
    for (const postId in allPosts) {
        if (allPosts[postId].creatorId === currentUser.uid) {
            myPostCount++;
        }
    }
    statPosts.innerText = myPostCount;
}

function renderAllTasks() {
    // Check if elements exist
    if (!currentUser || !allUsers || !availableTasksList || !myPostsList) return;
    
    availableTasksList.innerHTML = '';
    myPostsList.innerHTML = '';
    myPosts = {};
    
    let postsArray = [];
    for (const postId in allPosts) {
        postsArray.push({ id: postId, ...allPosts[postId] });
    }

    // --- Task List Sorting (Feature 6) ---
    postsArray.sort((a, b) => {
        const aIsAdmin = a.creatorUsername === ADMIN_USERNAME;
        const bIsAdmin = b.creatorUsername === ADMIN_USERNAME;
        const aIsMine = a.creatorId === currentUser.uid;
        const bIsMine = b.creatorId === currentUser.uid;

        if (aIsAdmin && !bIsAdmin) return -1;
        if (!aIsAdmin && bIsAdmin) return 1;

        if (aIsMine && !bIsMine) return -1;
        if (!aIsMine && bIsMine) return 1;

        return b.createdAt - a.createdAt;
    });

    // Loop and render
    postsArray.forEach(post => {
        const isCompleted = currentUser.completedTasks && currentUser.completedTasks[post.id];
        
        if (post.creatorId === currentUser.uid) {
            myPostsList.appendChild(createTaskCard(post, 'my-post'));
            myPosts[post.id] = post;
        } else if (!isCompleted) {
            const creator = allUsers[post.creatorId];
            if (creator) {
                const requiredPoints = TASK_REWARDS[post.taskType];
                if (creator.isAdmin || creator.points >= requiredPoints) {
                    availableTasksList.appendChild(createTaskCard(post, 'available'));
                }
            }
        }
    });
    
    if (availableTasksList.innerHTML === '') {
        availableTasksList.innerHTML = '<p>No available tasks right now. Check back later!</p>';
    }
    if (myPostsList.innerHTML === '') {
        myPostsList.innerHTML = '<p>You have not created any posts yet.</p>';
    }
}

// Helper function to create the HTML for a single task card
function createTaskCard(post, type) {
    const card = document.createElement('div');
    card.className = 'task-card';
    
    const points = TASK_REWARDS[post.taskType];
    const isCreatorAdmin = post.creatorUsername === ADMIN_USERNAME;

    let badgeClass = '';
    if (post.taskType === 'like') badgeClass = 'badge-like';
    if (post.taskType === 'comment') badgeClass = 'badge-comment';
    if (post.taskType === 'both') badgeClass = 'badge-both';

    let buttonHtml = '';
    if (type === 'available') {
        buttonHtml = `<button class="start-task-btn" data-post-id="${post.id}">Start Task</button>`;
    } else {
        buttonHtml = `<button class="remove-post-btn btn-danger" data-post-id="${post.id}">Remove Post</button>`;
    }
    
    card.innerHTML = `
        <div class="task-card-header">
            <div>
                <span class="task-badge ${badgeClass}">${post.taskType.toUpperCase()}</span>
            </div>
            <span class="points-badge">+${points} points</span>
        </div>
        <div class="task-card-body">
            <a href="${post.url}" target="_blank" rel="noopener noreferrer">${post.url}</a>
        </div>
        <div class="task-card-footer">
            ${buttonHtml}
        </div>
        <div class="verification-ui" id="verify-${post.id}" style="display:block;"></div>
    `;
    
    return card;
}

// --- Phase 4: Post Creation (Feature 4) ---
if (createPostForm) {
    createPostForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        postError.style.display = 'none';

        if (Object.keys(myPosts).length > 0) {
            postError.innerText = 'You may only have 1 active post. Please remove your old post first.';
            postError.style.display = 'block';
            return;
        }

        createPostBtn.disabled = true;
        createPostBtn.innerText = 'Posting...';

        const url = postUrlInput.value;
        const taskType = createPostForm.querySelector('input[name="taskType"]:checked').value;

        if (!url.includes('x.com') && !url.includes('twitter.com')) {
            postError.innerText = 'Please enter a valid X.com or Twitter.com URL.';
            postError.style.display = 'block';
            createPostBtn.disabled = false;
            createPostBtn.innerText = 'Create Post (Free)';
            return;
        }

        try {
            const newPost = {
                url: url,
                taskType: taskType,
                creatorId: currentUser.uid,
                creatorUsername: currentUser.username,
                createdAt: firebase.database.ServerValue.TIMESTAMP
            };
            
            // This command requires the "posts" write rule
            await db.ref('posts').push(newPost);
            // This command requires the "users" write rule
            await db.ref('users/' + currentUser.uid + '/postsCreated').set((currentUser.postsCreated || 0) + 1);

            postUrlInput.value = '';
        } catch (error) {
            postError.innerText = error.message;
            postError.style.display = 'block';
        } finally {
            createPostBtn.disabled = false;
            createPostBtn.innerText = 'Create Post (Free)';
        }
    });
}

if (myPostsList) {
    myPostsList.addEventListener('click', async (e) => {
        if (e.target.classList.contains('remove-post-btn')) {
            const btn = e.target;
            const postId = btn.dataset.postId;

            btn.disabled = true;
            btn.innerText = 'Removing...';

            try {
                await db.ref('posts/' + postId).remove();
            } catch (error) {
                alert('Could not remove post: ' + error.message);
                btn.disabled = false;
                btn.innerText = 'Remove Post';
            }
        }
    });
}


// --- Phase 5: Task Verification (Hidden Timer Logic) ---

function startVerification(button, post, postId) {
    const requiredTime = TASK_TIMES[post.taskType];
    
    const newTab = window.open(post.url);
    if (!newTab) {
        alert("Please allow popups for this site to complete tasks.");
        button.disabled = false;
        button.innerText = 'Start Task';
        return;
    }
    
    button.innerText = 'Mark as Complete';
    button.classList.remove('start-task-btn');
    button.classList.add('btn-success', 'pending-complete-btn');
    button.disabled = false;

    let timeSpent = 0;
    const timerInterval = setInterval(() => {
        timeSpent++;

        if (newTab.closed) {
            clearInterval(timerInterval);
            activeTaskTimers[postId] = { timeSpent: timeSpent, requiredTime: requiredTime, tabClosed: true };
            return;
        }

        activeTaskTimers[postId] = { timeSpent: timeSpent, requiredTime: requiredTime, tabClosed: false, interval: timerInterval, tab: newTab };

    }, 1000); 
    
    activeTaskTimers[postId] = { timeSpent: 0, requiredTime: requiredTime, tabClosed: false, interval: timerInterval, tab: newTab };
}

if (availableTasksList) {
    availableTasksList.addEventListener('click', async (e) => {
        const btn = e.target;
        
        if (btn.classList.contains('start-task-btn')) {
            const postId = btn.dataset.postId;
            const post = allPosts[postId];
            
            btn.disabled = true;
            btn.innerText = 'Checking...';

            const postCreatorRef = db.ref('users/' + post.creatorId);
            const postCreatorSnap = await postCreatorRef.once('value');
            const postCreator = postCreatorSnap.val();
            
            const requiredPoints = TASK_REWARDS[post.taskType];

            if (!postCreator) {
                 alert('Error: The creator of this post no longer exists.');
                 btn.innerText = 'Task Error';
                 return;
            }

            if (!postCreator.isAdmin && postCreator.points < requiredPoints) {
                alert('Error: The creator of this post does not have enough points to pay for this task.');
                btn.innerText = 'Creator Has No Points';
                return;
            }
            
            startVerification(btn, post, postId);
        }

        else if (btn.classList.contains('pending-complete-btn')) {
            const postId = btn.dataset.postId;
            const post = allPosts[postId];
            const verificationUI = document.getElementById(`verify-${postId}`);
            const taskTimer = activeTaskTimers[postId];

            if (!taskTimer) {
                verificationUI.innerHTML = `<p class="error-text" style="display:block;">Please start the task first.</p>`;
                setTimeout(() => { verificationUI.innerHTML = ''; }, 3000);
                return;
            }

            if (taskTimer.timeSpent >= taskTimer.requiredTime) {
                btn.disabled = true;
                btn.innerText = 'Completing...';

                clearInterval(taskTimer.interval);
                // --- THIS IS THE FIX (removed extra dot) ---
                if (taskTimer.tab && !taskTimer.tab.closed) {
                // --- END FIX ---
                    taskTimer.tab.close();
                }
                
                try {
                    // This command requires write access to /users/$uid (for two users)
                    await completeTask(postId, post);
                    alert('Task Complete! Points have been added to your account.');
                    delete activeTaskTimers[postId];
                } catch (error) {
                    alert('An error occurred: ' + error.message);
                    btn.disabled = false;
                    btn.innerText = 'Mark as Complete';
                }
            } else {
                verificationUI.innerHTML = `<p class="error-text" style="display:block;">Complete Task Right or try again</p>`;
                setTimeout(() => { verificationUI.innerHTML = ''; }, 3000);

                if (taskTimer.tabClosed) {
                    btn.innerText = 'Start Task';
                    btn.classList.remove('btn-success', 'pending-complete-btn');
                    btn.classList.add('start-task-btn');
                    delete activeTaskTimers[postId];
                }
            }
        }
    });
}


// --- Point Transfer Logic (Feature 2.3) ---
async function completeTask(postId, post) {
    const pointsToTransfer = TASK_REWARDS[post.taskType];
    const completerRef = db.ref('users/' + currentUser.uid);
    const creatorRef = db.ref('users/' + post.creatorId);

    // 1. Update the Post Creator
    await creatorRef.transaction((creatorData) => {
        if (creatorData) {
            if (!creatorData.isAdmin) {
                if (creatorData.points < pointsToTransfer) {
                    return; // Abort transaction
                }
                creatorData.points -= pointsToTransfer;
            }
        }
        return creatorData;
    });

    // 2. Update the Task Completer
    await completerRef.transaction((completerData) => {
        if (completerData) {
            completerData.points += pointsToTransfer;
            completerData.tasksCompleted = (completerData.tasksCompleted || 0) + 1;
            
            if (!completerData.completedTasks) {
                completerData.completedTasks = {};
            }
            completerData.completedTasks[postId] = true;
        }
        return completerData;
    });
}


// --- Phase 6: Inactivity Management ---
// (This is the new block of code)

/**
 * Disconnects the user from Firebase RTDB and shows the inactivity modal.
 */
function disconnectForInactivity() {
    console.log('User inactive for 5 minutes. Disconnecting from RTDB.');
    firebase.database().goOffline();
    if (inactivityOverlay) {
        inactivityOverlay.style.display = 'flex';
    }
}

/**
 * Resets the 5-minute inactivity timer.
 */
function resetInactivityTimer() {
    // Clear the old timer
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }
    
    // Start a new timer
    // We only set the timer if the user is actually logged in (currentUser exists)
    if (currentUser) {
        inactivityTimer = setTimeout(disconnectForInactivity, INACTIVITY_TIMEOUT);
    }
}

/**
 * Adds window-wide event listeners to detect user activity.
 */
function setupInactivityListeners() {
    // Events that count as "activity"
    window.addEventListener('mousemove', resetInactivityTimer);
    window.addEventListener('keydown', resetInactivityTimer);
    window.addEventListener('click', resetInactivityTimer);
    window.addEventListener('scroll', resetInactivityTimer);
    
    // Start the timer for the first time
    console.log('Setting up inactivity timer.');
    resetInactivityTimer();
}

/**
 * Removes all inactivity listeners and clears the timer.
 */
function clearInactivityListeners() {
    console.log('Clearing inactivity timer.');
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }
    window.removeEventListener('mousemove', resetInactivityTimer);
    window.removeEventListener('keydown', resetInactivityTimer);
    window.removeEventListener('click', resetInactivityTimer);
    window.removeEventListener('scroll', resetInactivityTimer);
}

/**
 * Handles the "Reconnect" button click.
 */
if (reconnectBtn) {
    reconnectBtn.addEventListener('click', () => {
        console.log('User reconnecting...');
        firebase.database().goOnline(); // Reconnect to Firebase
        
        if (inactivityOverlay) {
            inactivityOverlay.style.display = 'none'; // Hide the modal
        }
        
        // Restart the inactivity timer
        resetInactivityTimer();
    });
}
