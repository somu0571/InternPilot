(() => {
    const backToTopButton = document.getElementById('back-to-top-btn');

    if (backToTopButton) {
        let framePending = false;

        const updateBackToTopVisibility = () => {
            backToTopButton.classList.toggle('visible', window.scrollY > window.innerHeight);
            framePending = false;
        };

        window.addEventListener('scroll', () => {
            if (framePending) return;
            framePending = true;
            window.requestAnimationFrame(updateBackToTopVisibility);
        }, { passive: true });

        backToTopButton.addEventListener('click', () => {
            const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            window.scrollTo({ top: 0, left: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
        });

        updateBackToTopVisibility();
    }

    document.addEventListener('submit', event => {
        const form = event.target;
        if (!form || form.tagName !== 'FORM' || form.hasAttribute('data-no-loading')) return;
        if (typeof form.checkValidity === 'function' && !form.checkValidity()) return;
        if (form.getAttribute('aria-busy') === 'true') {
            event.preventDefault();
            return;
        }

        const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
        if (!submitButton) return;

        let loadingText = form.getAttribute('data-loading-text') || submitButton.getAttribute('data-loading-text');
        if (!loadingText) {
            const buttonText = (submitButton.textContent || submitButton.value || '').trim();
            if (/log\s*in/i.test(buttonText)) loadingText = 'Logging in...';
            else if (/register|create account/i.test(buttonText)) loadingText = 'Creating Account...';
            else if (/upload/i.test(buttonText)) loadingText = 'Uploading...';
            else if (/parse/i.test(buttonText)) loadingText = 'Parsing...';
            else if (/save|update/i.test(buttonText)) loadingText = 'Saving...';
            else if (/apply/i.test(buttonText)) loadingText = 'Submitting...';
            else if (/post/i.test(buttonText)) loadingText = 'Posting...';
            else if (/delete|remove/i.test(buttonText)) loadingText = 'Deleting...';
            else loadingText = 'Processing...';
        }

        form.setAttribute('aria-busy', 'true');
        submitButton.classList.add('pointer-events-none', 'opacity-80');
        submitButton.setAttribute('aria-disabled', 'true');

        const buttonWidth = submitButton.getBoundingClientRect().width;
        if (buttonWidth > 0) submitButton.style.minWidth = `${buttonWidth}px`;

        if (submitButton.tagName === 'INPUT') {
            submitButton.value = loadingText;
        } else {
            const spinnerMarkup = '<svg class="animate-spin -ml-1 mr-2 h-4 w-4 inline-block text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
            const loadingLabel = document.createElement('span');
            loadingLabel.textContent = loadingText;
            submitButton.replaceChildren();
            submitButton.insertAdjacentHTML('afterbegin', spinnerMarkup);
            submitButton.appendChild(loadingLabel);
        }

        setTimeout(() => {
            submitButton.disabled = true;
        }, 0);
    }, true);
})();