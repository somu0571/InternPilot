
const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        if (req.user && req.user.isActive === false) {
            req.logout((err) => {
                if (err) return next(err);
                req.flash('error_msg', 'Your account has been deactivated.');
                return res.redirect('/auth/login');
            });
            return;
        }
        return next();
    }
    req.flash('error_msg', 'Please log in to view this resource.');
    res.redirect('/auth/login');
};

const requireCompanyRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !req.user.companyId) {
            req.flash('error_msg', 'You do not belong to a valid company account.');
            return res.redirect('/');
        }
        if (!allowedRoles.includes(req.user.role)) {
            req.flash('error_msg', 'You do not have permission to access that section.');
            return res.redirect('/company/dashboard');
        }
        next();
    };
};

const authorize = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            req.flash('error_msg', 'Please log in to access this resource.');
            return res.redirect('/auth/login');
        }

        if (!allowedRoles.includes(req.user.role)) {
            req.flash('error_msg', 'You do not have permission to access that section.');

            if (req.user.role === 'admin') return res.redirect('/admin/dashboard');
            if (['company', 'recruiter', 'hiring_manager'].includes(req.user.role)) return res.redirect('/company/dashboard');
            return res.redirect('/');
        }

        next();
    };
};

module.exports = { isAuthenticated, authorize, requireCompanyRole };
