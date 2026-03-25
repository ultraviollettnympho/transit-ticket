'use strict';

/**
 * Metro Transit Mobile PWA - Application Logic
 * 
 * Purpose: Manage ticket state, rendering, persistence, and offline-first PWA functionality
 * Design Principles: Bulletproof error handling, zero-dependency vanilla JS ES6+
 * Offline Safety: All state persists to localStorage; JS timers continue when offline
 * Accessibility: ARIA-live updates for screen readers, keyboard event handling, focus management
 * 
 * Entry Point: DOMContentLoaded event
 * State Flow: init() → restoreState() → renderAll() → setupEventListeners()
 * 
 * Constants:
 * - MS_PER_MINUTE: 60000 (timer interval base unit)
 * - CACHE_VERSION: 'metro-transit-v1' (service worker cache key)
 * - LOCAL_STORAGE_KEY: 'metro_transit_state' (persistent state storage)
 * - MONTH_NAMES: Full month names for date formatting
 * - DEFAULT_DURATION, DURATION_MIN, DURATION_MAX: Input validation bounds
 * - TIMER_INTERVAL: 1000ms (1 second) for time updates
 * 
 * State Object: Cached DOM elements + application state
 * - activationTime: When ticket was activated (ISO date string)
 * - ticketDuration: Minutes of ticket validity
 * - ticketType: Pass type (Day Pass, 7-Day Pass, Monthly)
 * 
 * Event Handling: Keyboard (Escape to close modal), visibility change (timer updates)
 * Service Worker: Registered with fallback error handling if not available
 * 
 * Critical Functions:
 * - computeActivationTime(): Validates and returns activation time (now or provided time)
 * - getExpirationTime(): Calculates exact expiration by adding duration to activation time
 * - formatTime(): Returns 'HH:MM:SS AM/PM' format with locale fallback
 * - formatExpiration(): Returns 'MMM DD, YYYY at H:MM AM/PM' format
 * - persistState(): Saves to localStorage with error handling
 * - restoreState(): Loads from localStorage with null checks
 */

// ============================================================================
// CONSTANTS - Extracted for maintainability and testability
// ============================================================================

/** Milliseconds per minute (base timer unit) */
const MS_PER_MINUTE = 60000;

/** Service Worker cache version (update to invalidate old caches) */
const CACHE_VERSION = 'metro-transit-v1';

/** localStorage key for persistent application state */
const LOCAL_STORAGE_KEY = 'metro_transit_state';

/** Month names for date formatting (locale-independent) */
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/** Default ticket duration in minutes */
const DEFAULT_DURATION = 120; // 2 hours

/** Minimum valid ticket duration */
const DURATION_MIN = 1;

/** Maximum valid ticket duration */
const DURATION_MAX = 10080; // 7 days in minutes

/** Timer update interval in milliseconds (1 second for real-time display) */
const TIMER_INTERVAL = 1000;

// ============================================================================
// STATE OBJECT - Application state + DOM element cache for performance
// ============================================================================

/**
 * Global state object - holds both app state and cached DOM references
 * 
 * App State:
 * @property {string|null} activationTime - ISO string when ticket was activated
 * @property {number} ticketDuration - Minutes ticket is valid for
 * @property {string} ticketType - Type of pass (e.g., "Day Pass")
 * 
 * DOM Cache: All form elements, buttons, and display areas cached here for performance
 * Avoids repeated querySelector calls; reduces DOM thrashing
 */
const state = {
  // Application State
  activationTime: null,
  ticketDuration: DEFAULT_DURATION,
  ticketType: 'Day Pass',
  
  // Cached DOM Elements - initialized in init()
  els: {
    // Header and structure
    header: null,
    main: null,
    footer: null,
    
    // Display elements
    timeDisplay: null,
    time: null,
    date: null,
    platform: null,
    ticketType: null,
    expirationFull: null,
    expirationInfo: null,
    
    // Modal and settings
    modalOverlay: null,
    modalPanel: null,
    settingsForm: null,
    ticketTypeSelect: null,
    durationInput: null,
    timeInput: null,
    dateInput: null,
    
    // Buttons
    activateBtn: null,
    settingsBtn: null,
    applyBtn: null,
  },
  
  // Timer control
  timerInterval: null,
};

// ============================================================================
// UTILITY FUNCTIONS - String formatting and type conversion
// ============================================================================

/**
 * Pad a number to 2 digits with leading zero
 * 
 * @param {number} num - Number to pad
 * @returns {string} Padded string (e.g., '05' for 5)
 * @example
 *   pad(5) → '05'
 *   pad(12) → '12'
 */
function pad(num) {
  return String(num).padStart(2, '0');
}

/**
 * Format time as 'HH:MM:SS AM/PM' with locale fallback
 * 
 * Primary: Intl.DateTimeFormat for locale awareness (e.g., 24-hour vs 12-hour)
 * Fallback: Manual formatting if Intl fails (ensures zero console errors)
 * 
 * @param {Date} date - Date object to format
 * @returns {string} Formatted time (e.g., '2:33:45 PM')
 * @example
 *   formatTime(new Date('2024-01-15T14:33:45')) → '2:33:45 PM'
 */
function formatTime(date) {
  try {
    // Intl.DateTimeFormat approach: locale-aware, respects user settings
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    return formatter.format(date);
  } catch (err) {
    // Fallback: Manual formatting (reliable across all browsers/locales)
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12; // Convert 0 to 12 for 12am
    return `${displayHours}:${pad(minutes)}:${pad(seconds)} ${ampm}`;
  }
}

/**
 * Format expiration date as 'MMM DD, YYYY at H:MM AM/PM'
 * 
 * @param {Date} date - Expiration date to format
 * @returns {string} Formatted expiration (e.g., 'Dec 12, 2024 at 2:33 PM')
 * @example
 *   formatExpiration(new Date('2024-12-12T14:33:00')) → 'Dec 12, 2024 at 2:33 PM'
 */
function formatExpiration(date) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const parts = formatter.formatToParts(date);
    
    // Extract parts for precise formatting
    let month, day, year, hour, minute, period;
    parts.forEach(p => {
      if (p.type === 'month') month = p.value;
      if (p.type === 'day') day = p.value;
      if (p.type === 'year') year = p.value;
      if (p.type === 'hour') hour = p.value;
      if (p.type === 'minute') minute = p.value;
      if (p.type === 'literal' && p.value.includes('M')) period = p.value;
    });
    
    // Build formatted string
    if (month && day && year && hour && minute && period) {
      return `${month} ${day}, ${year} at ${hour}:${minute} ${period}`;
    }
    
    // If parts parsing fails, fall through to manual formatting
    throw new Error('Part parsing failed');
  } catch (err) {
    // Fallback: Manual formatting (guaranteed format)
    const monthStr = MONTH_NAMES[date.getMonth()];
    const dayStr = date.getDate();
    const yearStr = date.getFullYear();
    const hoursNum = date.getHours();
    const minutesStr = pad(date.getMinutes());
    const ampm = hoursNum >= 12 ? 'PM' : 'AM';
    const displayHours = hoursNum % 12 || 12;
    return `${monthStr} ${dayStr}, ${yearStr} at ${displayHours}:${minutesStr} ${ampm}`;
  }
}

/**
 * Calculate expiration time by adding duration to activation time
 * 
 * @param {Date} activationDate - When ticket was activated
 * @param {number} durationMinutes - Minutes the ticket is valid
 * @returns {Date} Expiration date/time
 * @example
 *   getExpirationTime(new Date(), 120) → Date 2 hours in future
 */
function getExpirationTime(activationDate, durationMinutes) {
  const expirationMs = activationDate.getTime() + (durationMinutes * MS_PER_MINUTE);
  return new Date(expirationMs);
}

/**
 * Validate ticket duration (range check)
 * 
 * @param {number} minutes - Duration to validate
 * @returns {boolean} True if within valid range [DURATION_MIN, DURATION_MAX]
 * @example
 *   validateDuration(120) → true
 *   validateDuration(0) → false
 *   validateDuration(20000) → false
 */
function validateDuration(minutes) {
  const num = parseInt(minutes, 10);
  return !isNaN(num) && num >= DURATION_MIN && num <= DURATION_MAX;
}

/**
 * Compute activation time - use provided time or current time
 * 
 * @param {string|null} timeInput - Time input from form (HH:MM format, optional)
 * @param {string|null} dateInput - Date input from form (YYYY-MM-DD format, optional)
 * @returns {Date} Activation time (now if inputs invalid/blank, otherwise parsed time)
 * @example
 *   computeActivationTime(null, null) → new Date() (now)
 *   computeActivationTime('14:30', '2024-01-15') → Date for Jan 15 2024 at 2:30 PM
 */
function computeActivationTime(timeInput, dateInput) {
  // Use current time if inputs are empty or invalid
  if (!timeInput || !dateInput) {
    return new Date();
  }
  
  try {
    // Parse time (HH:MM format)
    const timeParts = timeInput.split(':');
    if (timeParts.length !== 2) {
      return new Date();
    }
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);
    
    // Validate time ranges
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return new Date();
    }
    
    // Parse date (YYYY-MM-DD format)
    const dateParts = dateInput.split('-');
    if (dateParts.length !== 3) {
      return new Date();
    }
    const year = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1; // JS months are 0-indexed
    const day = parseInt(dateParts[2], 10);
    
    // Create date object
    const activationDate = new Date(year, month, day, hours, minutes, 0, 0);
    
    // Validate date is not in the past (warn but allow)
    return activationDate;
  } catch (err) {
    // Fallback to current time on any error
    return new Date();
  }
}

// ============================================================================
// RENDERING FUNCTIONS - Update DOM based on state
// ============================================================================

/**
 * Update time display (current time or time since activation)
 * Called every second by timer, updates: #time, #date, #platform
 */
function renderTime() {
  try {
    const now = new Date();
    
    // Format current time
    state.els.time.textContent = formatTime(now);
    
    // Format current date
    const monthStr = MONTH_NAMES[now.getMonth()];
    const dayStr = now.getDate();
    const yearStr = now.getFullYear();
    state.els.date.textContent = `${monthStr} ${dayStr}, ${yearStr}`;
    
    // Platform indicator
    state.els.platform.textContent = 'STATION ID: 42';
  } catch (err) {
    console.error('[renderTime] Error:', err);
    // Silent fail - don't break UX if time formatting fails
  }
}

/**
 * Update expiration display with color coding
 * Green (success): Not expired, >1 hour remaining
 * Orange (warning): <1 hour remaining
 * Red (error): Expired
 */
function renderExpiration() {
  try {
    if (!state.activationTime) {
      // No active ticket
      state.els.expirationInfo.className = 'expiration-info';
      state.els.expirationFull.textContent = 'No active ticket';
      return;
    }
    
    const activationDate = new Date(state.activationTime);
    const expirationDate = getExpirationTime(activationDate, state.ticketDuration);
    const now = new Date();
    const msRemaining = expirationDate.getTime() - now.getTime();
    const minutesRemaining = Math.floor(msRemaining / MS_PER_MINUTE);
    
    // Update text
    state.els.expirationFull.textContent = `Expires ${formatExpiration(expirationDate)}`;
    
    // Update color based on remaining time
    state.els.expirationInfo.className = 'expiration-info';
    if (msRemaining < 0) {
      // Expired
      state.els.expirationInfo.classList.add('expired');
      state.els.expirationFull.textContent = `Expired ${formatExpiration(expirationDate)}`;
    } else if (minutesRemaining < 60) {
      // Less than 1 hour remaining
      state.els.expirationInfo.classList.add('warning');
    } else {
      // More than 1 hour - success state
      state.els.expirationInfo.classList.add('success');
    }
  } catch (err) {
    console.error('[renderExpiration] Error:', err);
  }
}

/**
 * Update ticket type display
 * Shows current pass type (Day Pass, 7-Day Pass, Monthly)
 */
function renderTicketType() {
  try {
    state.els.ticketType.textContent = state.ticketType || 'Day Pass';
  } catch (err) {
    console.error('[renderTicketType] Error:', err);
  }
}

/**
 * Master render function - update all displays
 * Called on initialization and after state changes
 */
function renderAll() {
  renderTime();
  renderExpiration();
  renderTicketType();
}

/**
 * Update time display (calls renderTime)
 * Typically called by setInterval every second
 */
function updateTime() {
  renderTime();
  renderExpiration(); // Also update expiration as time progresses
}

// ============================================================================
// INTERACTION HANDLERS - User actions (button clicks, form submission)
// ============================================================================

/**
 * Activate a new ticket
 * 1. Save activation time to state
 * 2. Persist to localStorage
 * 3. Render updated displays
 * 4. Close settings modal if open
 */
function activateNewTicket() {
  try {
    // Use current time as activation time
    state.activationTime = new Date().toISOString();
    
    // Persist to localStorage
    persistState();
    
    // Update all displays
    renderAll();
    
    // Close modal if open
    closeModal();
  } catch (err) {
    console.error('[activateNewTicket] Error:', err);
    alert('Failed to activate ticket. Please try again.');
  }
}

/**
 * Toggle settings modal visibility
 * Opens if closed, closes if open
 */
function toggleSettings() {
  try {
    const isVisible = state.els.modalOverlay.classList.contains('visible');
    
    if (isVisible) {
      closeModal();
    } else {
      // Open modal and populate form with current state
      state.els.modalOverlay.classList.add('visible');
      
      // Pre-fill form with current values
      state.els.ticketTypeSelect.value = state.ticketType || 'Day Pass';
      state.els.durationInput.value = state.ticketDuration || DEFAULT_DURATION;
      
      // If activation time set, populate time/date fields
      if (state.activationTime) {
        const activDate = new Date(state.activationTime);
        state.els.timeInput.value = `${pad(activDate.getHours())}:${pad(activDate.getMinutes())}`;
        state.els.dateInput.value = activDate.toISOString().split('T')[0];
      } else {
        // Clear fields if no activation
        const now = new Date();
        state.els.timeInput.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        state.els.dateInput.value = now.toISOString().split('T')[0];
      }
      
      // Focus first input for accessibility
      state.els.ticketTypeSelect.focus();
    }
  } catch (err) {
    console.error('[toggleSettings] Error:', err);
  }
}

/**
 * Apply settings from form and activate ticket
 * 1. Validate duration input
 * 2. Update state
 * 3. Compute activation time from form inputs
 * 4. Render displays
 * 5. Close modal
 */
function applySettings() {
  try {
    const duration = parseInt(state.els.durationInput.value, 10);
    
    // Validate duration
    if (!validateDuration(duration)) {
      alert(`Duration must be between ${DURATION_MIN} and ${DURATION_MAX} minutes`);
      return;
    }
    
    // Update state from form
    state.ticketType = state.els.ticketTypeSelect.value || 'Day Pass';
    state.ticketDuration = duration;
    
    // Compute activation time from form inputs
    state.activationTime = computeActivationTime(
      state.els.timeInput.value,
      state.els.dateInput.value
    ).toISOString();
    
    // Persist to localStorage
    persistState();
    
    // Render displays
    renderAll();
    
    // Close modal
    closeModal();
  } catch (err) {
    console.error('[applySettings] Error:', err);
    alert('Failed to apply settings. Please try again.');
  }
}

/**
 * Close settings modal and optional refocus
 * Used by: Escape key, close button, successful apply
 */
function closeModal() {
  try {
    state.els.modalOverlay.classList.remove('visible');
    // Refocus activate button for keyboard navigation continuity
    if (state.els.activateBtn) {
      state.els.activateBtn.focus();
    }
  } catch (err) {
    console.error('[closeModal] Error:', err);
  }
}

/**
 * Close the entire app (PWA exit)
 * Used by iOS home screen button detection (optional)
 */
function closeApp() {
  try {
    // On PWA, close does nothing; on web, could go to metro.transit home
    if (window.navigator.standalone === true) {
      // Running as PWA - close window
      window.close();
    }
  } catch (err) {
    console.error('[closeApp] Error:', err);
  }
}

// ============================================================================
// EVENT HANDLERS - Keyboard, visibility, form submission
// ============================================================================

/**
 * Handle keyboard events
 * - Escape: Close settings modal
 * - Enter on form: Apply settings
 * 
 * @param {KeyboardEvent} event
 */
function handleKeyDown(event) {
  try {
    if (event.key === 'Escape') {
      closeModal();
    } else if (event.key === 'Enter' && event.target === state.els.settingsForm) {
      applySettings();
    }
  } catch (err) {
    console.error('[handleKeyDown] Error:', err);
  }
}

/**
 * Handle visibility change (page hidden/shown)
 * Ensures timer updates resume when page comes back into focus
 * 
 * @param {VisibilityEvent} event
 */
function handleVisibilityChange(event) {
  try {
    if (document.hidden) {
      // Page hidden - stop timer to save battery
      if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
      }
    } else {
      // Page visible again - restart timer
      if (!state.timerInterval) {
        // Force immediate update to avoid stale time
        updateTime();
        // Restart timer
        state.timerInterval = setInterval(updateTime, TIMER_INTERVAL);
      }
    }
  } catch (err) {
    console.error('[handleVisibilityChange] Error:', err);
  }
}

// ============================================================================
// PERSISTENCE - localStorage operations with error handling
// ============================================================================

/**
 * Save application state to localStorage
 * Silently fails if localStorage unavailable (errors don't break UX)
 * 
 * Persists: activationTime, ticketDuration, ticketType
 */
function persistState() {
  try {
    const stateData = {
      activationTime: state.activationTime,
      ticketDuration: state.ticketDuration,
      ticketType: state.ticketType,
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateData));
  } catch (err) {
    // Silently fail - possibly QuotaExceededError or private browsing
    // Don't alert user; ticket is still usable in current session
    console.warn('[persistState] localStorage unavailable:', err);
  }
}

/**
 * Restore application state from localStorage
 * Silently fails if localStorage unavailable or data missing
 * Uses default values if restoration fails
 */
function restoreState() {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!stored) {
      // No stored state - use defaults
      return;
    }
    
    const stateData = JSON.parse(stored);
    
    // Validate and restore
    if (stateData.activationTime) {
      state.activationTime = stateData.activationTime;
    }
    if (stateData.ticketDuration && validateDuration(stateData.ticketDuration)) {
      state.ticketDuration = stateData.ticketDuration;
    }
    if (stateData.ticketType) {
      state.ticketType = stateData.ticketType;
    }
  } catch (err) {
    // Silently fail - corrupt localStorage data
    // Continue with defaults
    console.warn('[restoreState] Failed to restore state:', err);
  }
}

// ============================================================================
// PWA SUPPORT - Service Worker registration
// ============================================================================

/**
 * Register Service Worker for offline support
 * Cache-first strategy: Serves cached assets when offline, networks assets when online
 * 
 * Errors are silently logged - failure doesn't break app functionality
 * PWA is progressive enhancement; app works even without SW
 */
function registerServiceWorker() {
  try {
    if (!navigator.serviceWorker) {
      console.log('[registerServiceWorker] Service Workers not supported');
      return;
    }
    
    navigator.serviceWorker.register('/service-worker.js')
      .then(registration => {
        console.log('[registerServiceWorker] Success:', registration);
      })
      .catch(err => {
        // Silent fail - offline functionality optional
        console.warn('[registerServiceWorker] Failed:', err);
      });
  } catch (err) {
    // Catch block for any thrown errors
    console.error('[registerServiceWorker] Error:', err);
  }
}

// ============================================================================
// MAIN INITIALIZATION - DOMContentLoaded event
// ============================================================================

/**
 * Main initialization function
 * 1. Cache all DOM elements
 * 2. Restore state from localStorage
 * 3. Render displays
 * 4. Setup event listeners
 * 5. Start timer interval
 * 6. Register service worker for offline support
 * 
 * Called on DOMContentLoaded (when DOM is ready)
 */
function init() {
  try {
    // ========== STEP 1: Cache DOM Elements ==========
    state.els = {
      // Structure
      header: document.querySelector('header[role="banner"]'),
      main: document.querySelector('main[role="main"]'),
      footer: document.querySelector('footer[role="contentinfo"]'),
      
      // Display elements
      timeDisplay: document.querySelector('.time-display'),
      time: document.getElementById('time'),
      date: document.getElementById('date'),
      platform: document.getElementById('platform'),
      ticketType: document.getElementById('ticket-type'),
      expirationFull: document.getElementById('expiration-full'),
      expirationInfo: document.querySelector('.expiration-info'),
      
      // Modal and form
      modalOverlay: document.getElementById('modal-overlay'),
      modalPanel: document.getElementById('modal-panel'),
      settingsForm: document.getElementById('settingsForm'),
      ticketTypeSelect: document.getElementById('ticketTypeSelect'),
      durationInput: document.getElementById('durationInput'),
      timeInput: document.getElementById('timeInput'),
      dateInput: document.getElementById('dateInput'),
      
      // Buttons
      activateBtn: document.querySelector('button[aria-label="Activate ticket"]'),
      settingsBtn: document.querySelector('button[aria-label="Open settings"]'),
      applyBtn: document.querySelector('button.primary'),
    };
    
    // Validate critical DOM elements exist
    if (!state.els.time || !state.els.activateBtn) {
      throw new Error('Critical DOM elements missing');
    }
    
    // ========== STEP 2: Restore State ==========
    restoreState();
    
    // ========== STEP 3: Render All Displays ==========
    renderAll();
    
    // ========== STEP 4: Setup Event Listeners ==========
    // Activate button
    if (state.els.activateBtn) {
      state.els.activateBtn.addEventListener('click', activateNewTicket);
    }
    
    // Settings button
    if (state.els.settingsBtn) {
      state.els.settingsBtn.addEventListener('click', toggleSettings);
    }
    
    // Apply settings (form submission or button)
    if (state.els.settingsForm) {
      state.els.settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        applySettings();
      });
    }
    if (state.els.applyBtn) {
      state.els.applyBtn.addEventListener('click', applySettings);
    }
    
    // Modal background click to close
    if (state.els.modalOverlay) {
      state.els.modalOverlay.addEventListener('click', (e) => {
        if (e.target === state.els.modalOverlay) {
          closeModal();
        }
      });
    }
    
    // Close button on modal header
    const closeBtn = document.querySelector('button[aria-label="Close settings"]');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }
    
    // Keyboard events
    document.addEventListener('keydown', handleKeyDown);
    
    // Visibility change (page hidden/shown)
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // ========== STEP 5: Start Timer ==========
    // Update time display immediately
    updateTime();
    
    // Start interval for continuous updates (1 second)
    state.timerInterval = setInterval(updateTime, TIMER_INTERVAL);
    
    // ========== STEP 6: Register Service Worker ==========
    registerServiceWorker();
    
    console.log('[init] Application initialized successfully');
  } catch (err) {
    console.error('[init] Initialization failed:', err);
    // Show error to user
    alert('Application initialization failed. Please reload the page.');
  }
}

// ============================================================================
// ENTRY POINT - Wait for DOM ready, then initialize
// ============================================================================

if (document.readyState === 'loading') {
  // DOM still loading - wait for DOMContentLoaded
  document.addEventListener('DOMContentLoaded', init);
} else {
  // DOM already loaded - initialize immediately
  init();
}