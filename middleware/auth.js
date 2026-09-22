
const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    req.flash('error_msg', 'Please log in to view this resource.');
    res.redirect('/auth/login');
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
            if (req.user.role === 'company') return res.redirect('/company/dashboard');
            return res.redirect('/');
        }

        next();
    };
};

module.exports = { isAuthenticated, authorize };