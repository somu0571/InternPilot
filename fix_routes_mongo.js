const fs = require('fs');

function fixRoute(file) {
    let c = fs.readFileSync(file, 'utf8');
    
    
    
    
    
    
    
    
    const newLogic = `
        const searchQuery = (req.query.search || '').trim();
        const statusFilter = (req.query.status || 'all').trim();
        const sortOrder = (req.query.sort || 'applied_desc').trim();

        
        const allApplications = await Application.find({ candidate: userId });
        const stats = {
            total: allApplications.length,
            submitted: allApplications.filter(a => (a.status || 'Submitted') === 'Submitted' || a.status === 'pending').length,
            underReview: allApplications.filter(a => a.status === 'Under Review').length,
            shortlisted: allApplications.filter(a => a.status === 'Shortlisted').length,
            rejected: allApplications.filter(a => a.status === 'Rejected').length
        };

        
        let query = { candidate: userId };

        if (statusFilter !== 'all') {
            if (statusFilter.toLowerCase() === 'submitted') {
                query.status = { $in: ['Submitted', 'pending'] };
            } else {
                
                query.status = new RegExp('^' + statusFilter.replace(/[-/\\\\^$*+?.()|[\\]{}]/g, '\\\\$&') + '$', 'i');
            }
        }

        
        if (searchQuery) {
            const Internship = require('../models/Internship');
            const escapeRegex = (text) => text.replace(/[-[\]{}()*+?.,\\\\^$|#\s]/g, '\\\\$&');
            const regex = new RegExp(escapeRegex(searchQuery), 'gi');
            
            
            const matchingInternships = await Internship.find({
                $or: [{ title: regex }, { companyName: regex }, { company: regex }]
            }).select('_id');
            
            const internshipIds = matchingInternships.map(i => i._id);
            query.internship = { $in: internshipIds };
        }

        
        let sortObj = { appliedAt: -1, _id: -1 };
        if (sortOrder === 'applied_asc') {
            sortObj = { appliedAt: 1, _id: 1 };
        } else if (sortOrder === 'updated_desc') {
            sortObj = { statusUpdatedAt: -1, _id: -1 };
        } else if (sortOrder === 'match_desc') {
            sortObj = { matchScore: -1, _id: -1 };
        }

        
        const applications = await Application.find(query)
            .populate('internship')
            .sort(sortObj);
`;

    
    const oldQueryRegex = /const applications = await Application\.find\(\{ candidate: userId \}\)[\s\S]*?rejected: applications\.filter\(a => a\.status === 'Rejected'\)\.length\s*\};\s*const searchQuery =[^;]+;\s*const statusFilter =[^;]+;\s*const sortOrder =[^;]+;[\s\S]*?filteredApps\.sort\([\s\S]*?\}\);/m;
    
    if (oldQueryRegex.test(c)) {
        c = c.replace(oldQueryRegex, newLogic);
        c = c.replace(/applications:\s*filteredApps/g, 'applications: applications');
        fs.writeFileSync(file, c);
        console.log(\`Successfully updated \${file}\`);
    } else {
        console.log(\`Could not match regex in \${file}\`);
    }
}

fixRoute('routes/user.js');
fixRoute('routes/candidate.js');

`;

fs.writeFileSync('fix_routes_mongo.js', CodeContent);
